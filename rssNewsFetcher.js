const Parser = require('rss-parser');
const fs = require('fs');

const parser = new Parser();
const RSS_FEED_URL = 'https://news.google.com/rss/search?q=egg+prices';
const CACHE_FILE = './rss_cache.json';
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

async function fetchEggNewsRSS() {
    const now = Date.now();

    // Check for cached data
    if (fs.existsSync(CACHE_FILE)) {
        const cachedData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        if (now - cachedData.timestamp < CACHE_DURATION) {
            return cachedData.articles;
        }
    }

    // Fetch from RSS feed
    try {
        const feed = await parser.parseURL(RSS_FEED_URL);
        const articles = feed.items.map((item) => ({
            title: item.title,
            link: item.link,
            pubDate: item.pubDate,
        }));

        // Cache the results
        fs.writeFileSync(
            CACHE_FILE,
            JSON.stringify({ timestamp: now, articles }, null, 2)
        );

        return articles;
    } catch (error) {
        console.error('Error fetching RSS feed:', error);
        return [];
    }
}

module.exports = fetchEggNewsRSS;
