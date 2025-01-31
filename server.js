const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const Parser = require('rss-parser');
const parser = new Parser();


const { SitemapStream, streamToPromise } = require('sitemap');
const { Readable } = require('stream');

const app = express();
const PORT = 3000;

// File to store cached data
const CACHE_FILE = path.join(__dirname, "cache.json");

// Cache validity duration in milliseconds (12 hours)
const CACHE_DURATION = 12 * 60 * 60 * 1000;

// Example: Replace with your actual data source for URLs
const fetchURLs = async() => {
    return [
        { url: '/', changefreq: 'daily', priority: 1.0 },
        { url: '/national-data', changefreq: 'daily', priority: 0.9 },
    ];
};

const generateSitemap = async() => {
    try {
        const baseUrl = 'https://eggprices.org'; // Replace with your site's URL
        const urls = await fetchURLs();

        const sitemap = new SitemapStream({ hostname: baseUrl });

        urls.forEach(({ url, changefreq, priority }) => {
            sitemap.write({ url, changefreq, priority });
        });

        sitemap.end();

        // Convert the stream to a promise
        const sitemapXml = await streamToPromise(sitemap);

        // Save the sitemap to a file
        const sitemapPath = path.join(__dirname, 'public', 'sitemap.xml');
        fs.writeFileSync(sitemapPath, sitemapXml);

        console.log('Sitemap generated successfully:', sitemapPath);
    } catch (error) {
        console.error('Error generating sitemap:', error);
    }
};

// generateSitemap();

// Middleware to serve static files
app.use(express.static("public"));

// Function to convert month name and year to last day of month date
function getLastDayOfMonth(year, monthName) {
    const monthIndex = new Date(Date.parse(monthName + " 1, 2000")).getMonth();
    return new Date(year, monthIndex + 1, 0).toISOString().split('T')[0];
}

// Function to transform BLS data format to desired format
function transformBLSData(rawData) {
    return rawData.map(item => ({
        date: getLastDayOfMonth(item.year, item.periodName),
        value: parseFloat(item.value)
    }));
}

// Function to fetch only the most recent data from BLS API
async function fetchEggPrices() {
    const apiUrl = "https://api.bls.gov/publicAPI/v1/timeseries/data/";
    const currentYear = new Date().getFullYear();
    // Only fetch last 2 years of data to get recent updates
    const payload = {
        seriesid: ["APU0000708111"],
        startyear: (currentYear - 1).toString(),
        endyear: currentYear.toString(),
    };

    try {
        const response = await axios.post(apiUrl, payload, {
            headers: {
                "Content-Type": "application/json",
            },
        });

        if (response.data.status === "REQUEST_SUCCEEDED") {
            const newData = transformBLSData(response.data.Results.series[0].data);

            // Read existing cache or create empty data
            let existingData = { data: [], timestamp: Date.now() };
            if (fs.existsSync(CACHE_FILE)) {
                existingData = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
            }

            // Merge new data with existing data, avoiding duplicates
            const mergedData = [...existingData.data];
            newData.forEach(newItem => {
                const existingIndex = mergedData.findIndex(item => item.date === newItem.date);
                if (existingIndex === -1) {
                    mergedData.push(newItem);
                } else {
                    mergedData[existingIndex] = newItem;
                }
            });

            // Sort by date
            mergedData.sort((a, b) => new Date(a.date) - new Date(b.date));

            const data = {
                data: mergedData,
                timestamp: Date.now(),
            };

            // Write updated data to cache file
            fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
            console.log("Cache updated and saved to file.");
            return data;
        } else {
            console.error("API request failed:", response.data.message);
            throw new Error("Failed to fetch data from API");
        }
    } catch (error) {
        console.error("Error fetching data from BLS API:", error);
        throw error;
    }
}

// Function to get cached data (reads from file)
function getCachedData() {
    if (fs.existsSync(CACHE_FILE)) {
        const fileData = fs.readFileSync(CACHE_FILE, "utf-8");
        const cachedData = JSON.parse(fileData);

        // Check if cache is still valid
        if (Date.now() - cachedData.timestamp < CACHE_DURATION) {
            console.log("Serving data from cache.");
            return cachedData;
        } else {
            console.log("Cache expired. Fetching new data.");
        }
    } else {
        console.log("Cache file not found. Fetching new data.");
    }
    return null;
}

// Updated route to always serve from cache
app.get("/api/egg-prices", async(req, res) => {
    try {
        let data = getCachedData();
        const months = parseInt(req.query.months) || 120; // Default to 10 years

        if (!data) {
            data = await fetchEggPrices();
        }

        // Filter data based on requested months
        const currentDate = new Date();
        const filteredData = data.data.filter(item => {
            const itemDate = new Date(item.date);
            const monthsDiff = (currentDate.getFullYear() - itemDate.getFullYear()) * 12 +
                (currentDate.getMonth() - itemDate.getMonth());
            return monthsDiff <= months;
        });

        res.json({
            data: filteredData,
            lastUpdated: new Date(data.timestamp).toISOString(),
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch data." });
    }
});

// Route to force cache update
app.post("/api/force-update", async(req, res) => {
    try {
        const data = await fetchEggPrices(); // Fetch new data and update cache
        res.json({
            message: "Cache updated successfully.",
            data: data.data,
            lastUpdated: new Date(data.timestamp).toISOString(),
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to update cache." });
    }
});

app.post("/api/force-update-news", async(req, res) => {
    try {
        const articles = await fetchEggNewsRSS();
        res.json(articles);
    } catch (error) {
        res.status(500).json({ error: "Failed to update news cache." });
    }
});

// Add the RSS feed function
async function fetchEggNewsRSS() {
    const RSS_FEED_URL = 'https://news.google.com/rss/search?q=egg+prices+US&hl=en-US&gl=US&ceid=US:en';
    const CACHE_FILE = path.join(__dirname, 'rss_cache.json');
    const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

    // Check for cached data
    if (fs.existsSync(CACHE_FILE)) {
        const cachedData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        if (Date.now() - cachedData.timestamp < CACHE_DURATION) {
            return cachedData.articles;
        }
    }

    try {
        const feed = await parser.parseURL(RSS_FEED_URL);
        const articles = feed.items
            .slice(0, 12) // Limit to 12 articles
            .map(item => ({
                title: item.title,
                link: item.link,
                pubDate: item.pubDate
            }));

        // Cache the results
        fs.writeFileSync(
            CACHE_FILE,
            JSON.stringify({
                timestamp: Date.now(),
                articles
            }, null, 2)
        );

        return articles;
    } catch (error) {
        console.error('Error fetching RSS feed:', error);
        throw error;
    }
}


// Update the news endpoint to include better error handling
app.get('/api/news', async(req, res) => {
    try {
        const articles = await fetchEggNewsRSS();
        res.json(articles);
    } catch (error) {
        console.error('Failed to fetch news:', error);
        res.status(500).json({
            error: 'Failed to fetch news',
            message: error.message
        });
    }
});

// Function to fetch daily egg prices
async function fetchDailyEggPrices() {
    const DAILY_PRICE_URL = 'https://egg-prices-daily-9e97519ea502.herokuapp.com/scrape';

    try {
        const response = await axios.get(DAILY_PRICE_URL);
        const { price, timestamp } = response.data;

        // Convert timestamp to Date object and subtract 2 days
        const dateObj = new Date(timestamp);
        dateObj.setDate(dateObj.getDate() - 2);
        const date = dateObj.toISOString().split('T')[0];

        // Read existing cache
        let existingData = { data: [], timestamp: Date.now() };
        if (fs.existsSync(CACHE_FILE)) {
            existingData = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
        }

        // Create new data point
        const newDataPoint = {
            date,
            value: parseFloat(price)
        };

        // Merge with existing data, avoiding duplicates
        const mergedData = [...existingData.data];
        const existingIndex = mergedData.findIndex(item => item.date === date);
        if (existingIndex === -1) {
            mergedData.push(newDataPoint);
        } else {
            mergedData[existingIndex] = newDataPoint;
        }

        // Sort by date
        mergedData.sort((a, b) => new Date(a.date) - new Date(b.date));

        const data = {
            data: mergedData,
            timestamp: Date.now(),
        };

        // Write updated data to cache file
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
        console.log("Daily price cache updated and saved to file.");
        return data;
    } catch (error) {
        console.error("Error fetching daily egg prices:", error);
        throw error;
    }
}

// Update cron schedules
// Run BLS data update every 12 hours
cron.schedule("0 */12 * * *", async() => {
    try {
        await fetchEggPrices();
    } catch (error) {
        console.error("Scheduled BLS cache update failed:", error);
    }
});

// Run daily price update at midnight every day
cron.schedule("0 0 * * *", async() => {
    try {
        await fetchDailyEggPrices();
    } catch (error) {
        console.error("Scheduled daily price update failed:", error);
    }
});

// Add route to force daily price update
app.post("/api/force-update-daily", async(req, res) => {
    try {
        const data = await fetchDailyEggPrices();
        res.json({
            message: "Daily price cache updated successfully.",
            data: data.data,
            lastUpdated: new Date(data.timestamp).toISOString(),
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to update daily price cache." });
    }
});


// Add this new route
app.get('/national-data', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'national-data.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});




// Start the server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});