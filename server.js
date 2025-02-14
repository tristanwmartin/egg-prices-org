const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const Parser = require('rss-parser');
const parser = new Parser();


const { SitemapStream, streamToPromise } = require('sitemap');
const { Readable } = require('stream');
const { createCanvas, registerFont, loadImage } = require('canvas');
const fsPromises = require('fs').promises;

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

// Register fonts - update the paths and names to match your actual font files
registerFont(path.join(__dirname, 'public/fonts/HostGrotesk-Bold.ttf'), { 
    family: 'Host Grotesk Bold',  // Make sure this matches exactly how you reference it
    weight: 'bold'
});
registerFont(path.join(__dirname, 'public/fonts/Teko-Bold.ttf'), { 
    family: 'Teko Bold',  // Make sure this matches exactly how you reference it
    weight: 'bold'
});

// Check if fonts are readable
try {
    fs.accessSync(path.join(__dirname, 'public/fonts/HostGrotesk-Bold.ttf'));
    console.log('Host Grotesk font is readable');
    fs.accessSync(path.join(__dirname, 'public/fonts/Teko-Bold.ttf'));
    console.log('Teko font is readable');
} catch (err) {
    console.error('Error accessing fonts:', err);
}

// You can also try logging the full path to debug
console.log('Font path:', path.join(__dirname, 'public/fonts/HostGrotesk-Bold.ttf'));

async function generateShareImage(data) {
    const canvas = createCanvas(1200, 1200);
    const ctx = canvas.getContext('2d');

    // Constants for layout - adjusted margins
    const PADDING = 60;
    const HEADER_HEIGHT = 140;
    const FOOTER_HEIGHT = 60;
    const CHART_MARGIN_Y = 100; // New constant for vertical chart margins
    const CONTENT_HEIGHT = canvas.height - HEADER_HEIGHT - FOOTER_HEIGHT - (CHART_MARGIN_Y * 2); // Adjusted for margins
    
    // Set background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw header background with shadow
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.33)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 2;
    ctx.fillRect(0, 0, canvas.width, HEADER_HEIGHT);
    
    // Draw footer background with shadow
    ctx.fillRect(0, canvas.height - FOOTER_HEIGHT, canvas.width, FOOTER_HEIGHT);
    ctx.shadowColor = 'transparent';
    
    // Draw logo in header (smaller)
    const logo = await loadImage(path.join(__dirname, 'public/img/ep-logo-color.png'));
    ctx.drawImage(logo, PADDING, (HEADER_HEIGHT - 60) / 2, 60, 60);  // Reduced size
    
    // Add EggPrices.org text next to logo
    ctx.font = '42px "Host Grotesk Bold"';  // Reduced font size
    ctx.fillStyle = '#4b2e15';
    ctx.textAlign = 'left';
    ctx.fillText('EggPrices.org', PADDING + 80, HEADER_HEIGHT/2 + 14);
    
    // Add "Nationwide Data" text on right
    ctx.font = '32px "Host Grotesk Bold"';
    ctx.fillStyle = '#666666';
    ctx.textAlign = 'right';
    ctx.fillText('Nationwide Data', canvas.width - PADDING, HEADER_HEIGHT/2 + 10);
    
    // Draw grid lines and axis labels - adjusted y-positions
    const prices = data.data.slice(-60);
    const maxPrice = Math.ceil(Math.max(...prices.map(p => p.value)));
    const minPrice = Math.floor(Math.min(...prices.map(p => p.value)));
    const priceRange = maxPrice - minPrice;
    
    // Draw grid lines and price labels
    ctx.font = '16px "Host Grotesk Bold"';
    ctx.fillStyle = '#666666';
    ctx.textAlign = 'right';
    
    // Draw major grid lines (dollars)
    for (let price = Math.floor(minPrice); price <= Math.ceil(maxPrice); price++) {
        const y = HEADER_HEIGHT + CHART_MARGIN_Y + CONTENT_HEIGHT - 
                 ((price - minPrice) / priceRange) * CONTENT_HEIGHT;
        
        // Draw major grid line
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PADDING + 30, y);
        ctx.lineTo(canvas.width - PADDING, y);
        ctx.stroke();
        
        // Draw price label for major lines
        ctx.fillText(`$${price.toFixed(2)}`, PADDING + 25, y + 5);
    }

    // Draw minor grid lines (10-cent increments)
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 0.5;
    for (let price = Math.floor(minPrice * 10) / 10; price <= Math.ceil(maxPrice * 10) / 10; price += 0.1) {
        // Skip if this is a major grid line
        if (Math.abs(Math.round(price) - price) < 0.01) continue;
        
        const y = HEADER_HEIGHT + CHART_MARGIN_Y + CONTENT_HEIGHT - 
                 ((price - minPrice) / priceRange) * CONTENT_HEIGHT;
        
        ctx.beginPath();
        ctx.moveTo(PADDING + 30, y);
        ctx.lineTo(canvas.width - PADDING, y);
        ctx.stroke();
    }
    
    // Draw date labels and vertical grid lines with more dates
    ctx.textAlign = 'center';
    ctx.font = '16px "Host Grotesk Bold"';
    // Show more dates (every 3 months)
    const dateLabels = [];
    for (let i = 0; i < prices.length; i += Math.floor(prices.length / 8)) {  // Show ~8 dates
        dateLabels.push(prices[i]);
    }


    dateLabels.forEach((price) => {
        const index = prices.indexOf(price);
        const x = PADDING + 30 + ((canvas.width - PADDING * 2 - 30) * index / (prices.length - 1));
        const date = new Date(price.date);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        
        // Draw vertical grid line
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, HEADER_HEIGHT + CHART_MARGIN_Y);
        ctx.lineTo(x, HEADER_HEIGHT + CHART_MARGIN_Y + CONTENT_HEIGHT);
        ctx.stroke();
        
        // Draw date label
        ctx.fillStyle = '#666666';
        ctx.fillText(dateStr, x, canvas.height - FOOTER_HEIGHT - (CHART_MARGIN_Y / 2));
    });
    
    // Draw price line with gradient fill
    ctx.beginPath();
    ctx.strokeStyle = '#d68c45';
    ctx.lineWidth = 6;
    
    // Create points array for filling and store last point
    const points = [];
    let lastPoint;
    prices.forEach((price, i) => {
        const x = PADDING + 30 + ((canvas.width - PADDING * 2 - 30) * i / (prices.length - 1));
        const y = HEADER_HEIGHT + CHART_MARGIN_Y + CONTENT_HEIGHT - 
                 ((price.value - minPrice) / priceRange) * CONTENT_HEIGHT;
        points.push({x, y});
        if (i === prices.length - 1) lastPoint = {x, y};
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            const previousPoint = points[i - 1];
            const tension = 0.3;
            
            const cp1x = previousPoint.x + (x - previousPoint.x) * tension;
            const cp1y = previousPoint.y;
            const cp2x = previousPoint.x + (x - previousPoint.x) * (1 - tension);
            const cp2y = y;
            
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
        }
    });
    
    // Draw the line
    ctx.stroke();
    
    // Fill area under the line
    ctx.lineTo(canvas.width - PADDING, HEADER_HEIGHT + CHART_MARGIN_Y + CONTENT_HEIGHT); // Stop at bottom of chart
    ctx.lineTo(PADDING + 30, HEADER_HEIGHT + CHART_MARGIN_Y + CONTENT_HEIGHT); // Stop at bottom of chart
    ctx.closePath();

    // Create gradient with adjusted stops
    const gradient = ctx.createLinearGradient(
        0, 
        HEADER_HEIGHT + CHART_MARGIN_Y, // Start at top of chart
        0, 
        HEADER_HEIGHT + CHART_MARGIN_Y + CONTENT_HEIGHT // End at bottom of chart
    );
    gradient.addColorStop(0, 'rgba(214, 140, 69, 0.2)');
    gradient.addColorStop(0.8, 'rgba(214, 140, 69, 0.05)'); // Start fading earlier
    gradient.addColorStop(1, 'rgba(214, 140, 69, 0)'); // Completely transparent at bottom
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Draw annotation for current price
    const currentPrice = prices[prices.length - 1].value;
    // Position annotation in center of chart horizontally
    const annotationX = (canvas.width / 2) - 150;  // Centered, accounting for width
    const annotationHeight = 225;
    const annotationY = lastPoint.y - annotationHeight/2;   // Position centered on last point
    
    // Draw annotation background
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.33)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    roundRect(ctx, annotationX, annotationY, 325, annotationHeight, 10);  // Increased size
    ctx.fill();
    ctx.shadowColor = 'transparent';
    
    // Draw dashed line to price point
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 2;
    ctx.moveTo(annotationX + 325, lastPoint.y);  // Start from right edge of annotation at price level
    ctx.lineTo(lastPoint.x, lastPoint.y);  // Draw straight to price point
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Add annotation text (larger)
    ctx.textAlign = 'left';
    ctx.font = '24px "Host Grotesk Bold"';  // Increased font size
    ctx.fillStyle = '#4b2e15';
    ctx.fillText('Current National Average', annotationX + 25, annotationY + 35);
    
    ctx.font = '128px "Teko Bold"';  // Increased font size
    ctx.fillStyle = '#d68c45';
    ctx.fillText(`$${currentPrice.toFixed(2)}`, annotationX + 25, annotationY + 150);

    // Add per dozen text
    ctx.font = '24px "Host Grotesk Bold"';
    ctx.fillStyle = '#4b2e15';
    // center text
    ctx.fillText('per dozen eggs', annotationX + 75, annotationY + 195);
    
    // Add footer with date
    const currentDate = new Date().toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        day: 'numeric'
    });
    
    // Draw date pill
    const dateText = `As of ${currentDate}`;
    ctx.font = '26px "Host Grotesk Bold"';
    const dateWidth = ctx.measureText(dateText).width + 50;
    
    // Draw pill background
    ctx.fillStyle = '#d68c45';
    const pillX = canvas.width - dateWidth;
    const pillY = canvas.height - FOOTER_HEIGHT;
    roundRect(ctx, pillX, pillY, dateWidth, FOOTER_HEIGHT, 0);
    ctx.fill();
    // Add date text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(dateText, pillX + dateWidth/2, pillY + 37);

    // add source text left aligned to canvas with padding  
    ctx.font = '16px "Host Grotesk Bold"';
    ctx.fillStyle = '#666666';
    ctx.fillText('Source: BLS and USDA via EggPrices.org', PADDING + canvas.width/2, canvas.height - FOOTER_HEIGHT/2 + 5);

    // After drawing the price line, add the endpoint circle
    const endpointRadius = 8;
    // Draw white fill circle
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, endpointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    // Draw orange stroke circle
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#d68c45';
    ctx.stroke();

    return canvas.toBuffer('image/png');
}

// Helper function to draw rounded rectangles
function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// Add route to serve the share image
app.get('/api/share-image', async (req, res) => {
    try {
        const cachedData = getCachedData();
        const imageBuffer = await generateShareImage(cachedData);
        
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=21600'); // 6 hours
        res.send(imageBuffer);
    } catch (error) {
        console.error('Error generating share image:', error);
        res.status(500).send('Error generating image');
    }
});

// Update meta tags when cache is updated
async function updateMetaTags() {
    try {
        const cachedData = getCachedData();
        const currentPrice = cachedData.data[cachedData.data.length - 1].value;
        const currentDate = new Date().toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });

        const metaHtml = `
            <meta property="og:title" content="Current Egg Prices - $${currentPrice.toFixed(2)} per dozen">
            <meta property="og:description" content="Track nationwide egg prices and trends. Updated ${currentDate}.">
            <meta property="og:image" content="https://eggprices.org/api/share-image">
            <meta property="og:url" content="https://eggprices.org/national-data">
            <meta name="twitter:card" content="summary_large_image">
        `;

        const htmlPath = path.join(__dirname, 'public', 'national-data.html');
        let html = await fsPromises.readFile(htmlPath, 'utf8');
        
        // Replace existing meta tags or add new ones
        html = html.replace(
            /<meta property="og:.*?>/g,
            metaHtml
        );

        await fsPromises.writeFile(htmlPath, html);
        console.log('Meta tags updated successfully');
    } catch (error) {
        console.error('Error updating meta tags:', error);
    }
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

            // After updating cache, also update meta tags
            await updateMetaTags();
            
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
// cron.schedule("0 */12 * * *", async() => {
//     try {
//         await fetchEggPrices();
//     } catch (error) {
//         console.error("Scheduled BLS cache update failed:", error);
//     }
// });

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