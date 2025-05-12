const fs = require('fs');
const path = require('path');
const os = require('os');
const rimraf = require('rimraf');
const bcrypt = require('bcrypt');
const { Octokit } = require('@octokit/rest');

exports.handler = async (event, context) => {
    console.log('Function started');
    console.log('Event:', JSON.stringify(event, null, 2));

    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Check authentication
    const providedPassword = event.headers['x-admin-password'];
    if (!providedPassword) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Authentication required' })
        };
    }

    try {
        const isValid = await bcrypt.compare(providedPassword, process.env.ADMIN_PASSWORD);
        if (!isValid) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid password' })
            };
        }

        // Parse the request body
        let content = '';
        let imageBuffer = null;
        let imagePosition = 'below';

        try {
            const body = JSON.parse(event.body);
            content = body.content || '';
            imagePosition = body.imagePosition || 'below';
            
            if (body.image) {
                imageBuffer = Buffer.from(body.image.split(',')[1], 'base64');
            }
        } catch (parseError) {
            console.error('Error parsing request body:', parseError);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid request format' })
            };
        }

        // Validate content
        if (!content || typeof content !== 'string' || content.length > 10000) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid content' })
            };
        }

        console.log('Content validated, proceeding with GitHub operations');

        // Initialize Octokit
        const octokit = new Octokit({
            auth: process.env.GITHUB_PAT
        });

        const owner = 'axelvaldez';
        const repo = 'axel.mx';
        const branch = 'main';

        // Generate filename and content
        const date = new Date();
        date.setHours(date.getHours() - 7); // Convert to GMT-7
        const filename = date.toISOString().replace(/[:.]/g, '-').slice(0, 16);
        const filePath = `_src/updates/${filename}.md`;

        let markdownContent = `---
title: ${filename}
date: ${date.toISOString()}
permalink: "updates/{{ page.date | date: '%Y%m%d%H%M%S' }}/index.html"
---\n`;

        // Handle image if uploaded
        if (imageBuffer) {
            console.log('Processing image upload');
            const imageFilename = `${Date.now()}-${Math.round(Math.random() * 1E9)}.jpg`;
            const imagePath = `assets/img/uploads/${imageFilename}`;
            const imageMarkdown = `<p><img src="/${imagePath}" alt="Uploaded image"></p>\n\n`;
            
            if (imagePosition === 'above') {
                markdownContent += imageMarkdown + content;
            } else {
                markdownContent += content + '\n\n' + imageMarkdown;
            }

            // Upload image file
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: imagePath,
                message: `Add image ${imageFilename}`,
                content: imageBuffer.toString('base64'),
                branch
            });
        } else {
            markdownContent += content;
        }

        // Upload markdown file
        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: filePath,
            message: `Add update ${filename}`,
            content: Buffer.from(markdownContent).toString('base64'),
            branch
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Update published successfully!' })
        };
    } catch (error) {
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            command: error.command
        });

        return {
            statusCode: 500,
            body: JSON.stringify({ 
                success: false, 
                message: 'Failed to publish update. Please try again.',
                error: error.message
            })
        };
    }
}; 