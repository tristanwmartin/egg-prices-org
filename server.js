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

// Function to fetch data from the BLS API
async function fetchEggPrices() {
    const apiUrl = "https://api.bls.gov/publicAPI/v1/timeseries/data/";
    const currentYear = new Date().getFullYear();
    const payload = {
        seriesid: ["APU0000708111"],
        startyear: "2015",
        endyear: currentYear.toString(),
    };

    try {
        const response = await axios.post(apiUrl, payload, {
            headers: {
                "Content-Type": "application/json",
            },
        });

        if (response.data.status === "REQUEST_SUCCEEDED") {
            const data = {
                data: response.data.Results.series[0].data,
                timestamp: Date.now(),
            };

            // Write data to the cache file
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

// Route to serve data
app.get("/api/egg-prices", async(req, res) => {
    try {
        let data = getCachedData();
        const months = parseInt(req.query.months) || 120; // Default to 10 years (120 months)

        if (!data) {
            // Fetch new data if no valid cache
            data = await fetchEggPrices();
        }

        // Filter data based on requested months
        const currentDate = new Date();
        const filteredData = data.data.filter(item => {
            const itemDate = new Date(item.year, getMonthNumber(item.periodName) - 1);
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

// Schedule cache refresh every 12 hours
cron.schedule("0 */12 * * *", async() => {
    try {
        await fetchEggPrices();
    } catch (error) {
        console.error("Scheduled cache update failed:", error);
    }
});

// Helper function to convert month names to numbers
function getMonthNumber(periodName) {
    const months = {
        'January': 1,
        'February': 2,
        'March': 3,
        'April': 4,
        'May': 5,
        'June': 6,
        'July': 7,
        'August': 8,
        'September': 9,
        'October': 10,
        'November': 11,
        'December': 12
    };
    return months[periodName] || 1;
}

// Route to serve data
app.get("/api/egg-prices", async(req, res) => {
    try {
        let data = getCachedData();
        const months = parseInt(req.query.months) || 120; // Default to 10 years (120 months)

        if (!data) {
            // Only fetch new data if cache doesn't exist at all
            data = await fetchEggPrices();
        }
        // Note: We're now using cached data even if expired, to reduce API calls

        // Filter data based on requested months
        const currentDate = new Date();
        const filteredData = data.data.filter(item => {
            const itemDate = new Date(item.year, getMonthNumber(item.periodName) - 1);
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

// Add this new route
app.get('/national-data', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'national-data.html'));
});




// Start the server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});