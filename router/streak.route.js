const { Router } = require("express");
const fs = require('fs').promises;
const path = require('path');
const cache = require("apicache").middleware;
const fetch = require('node-fetch');

require('cachedfs').patchInPlace();

const SteaksRouter = Router();

SteaksRouter.get("/:username", cache("1 minute"), async (req, res) => {
    const { username } = req.params;
    const { theme = 'dark', size, border = "797067" } = req.query;

    // GraphQL query to get contributions for the user
    const query = `
    {
        user(login: "${username}") {
            contributionsCollection {
                contributionCalendar {
                    weeks {
                        contributionDays {
                            contributionCount
                            date
                        }
                    }
                }
            }
        }
    }`;

    try {
        // Fetch contributions using the GitHub GraphQL API
        const response = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.GH_TOKEN}`,
            },
            body: JSON.stringify({ query }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const result = await response.json();
        const weeks = result.data.user.contributionsCollection.contributionCalendar.weeks;
        
        // Flatten the array of contribution days across weeks
        const contributions = weeks.flatMap(week => week.contributionDays.map(day => ({
            count: day.contributionCount,
            date: day.date
        })));

        function calculateStreaks(contributions) {
            if (contributions.length === 0) return 0;

            const validContributions = contributions
                .filter(contribution => new Date(contribution.date) <= new Date())
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            let maxStreak = 0;
            let currentStreak = 0;

            for (let i = 0; i < validContributions.length; i++) {
                const currentContribution = validContributions[i];

                if (currentContribution.count > 0) {
                    currentStreak = 1;
                    for (let j = i + 1; j < validContributions.length; j++) {
                        const prevContribution = validContributions[j - 1];
                        const nextContribution = validContributions[j];

                        const diff = (new Date(prevContribution.date) - new Date(nextContribution.date)) / (1000 * 60 * 60 * 24);

                        if (diff === 1 && nextContribution.count > 0) {
                            currentStreak++;
                        } else {
                            break;
                        }
                    }
                    maxStreak = Math.max(maxStreak, currentStreak);
                    break;
                }
            }

            return maxStreak;
        }

        const numberOfStreaks = calculateStreaks(contributions);

        // Select SVG theme
        const themeFile = theme === 'light' ? 'light.svg' : 'dark.svg';
        const filePath = path.join(__dirname, `./../assets/streak/${themeFile}`);

        // Read SVG file asynchronously
        let svgContent = await fs.readFile(filePath, 'utf8');

        // Replace placeholders with actual data
        svgContent = svgContent.replace(/\$num/g, encodeURIComponent(numberOfStreaks))
                               .replace(/\$size/g, encodeURIComponent(size || 250))
                               .replace(/\$stroke/g, `stroke="${encodeURIComponent(border)}"`);

        // Send the modified SVG as a response
        res.setHeader('Content-Type', 'image/svg+xml');
        res.send(svgContent);
    } catch (error) {
        console.error('Error fetching contributions:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = SteaksRouter;
