const fs = require('fs');
const path = require('path');
const os = require('os');
const rimraf = require('rimraf');
const simpleGit = require('simple-git');
const bcrypt = require('bcrypt');

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

        console.log('Content validated, proceeding with git operations');

        const tempDir = path.join(os.tmpdir(), 'vibecoding-temp');
        const targetRepo = `https://${process.env.GITHUB_PAT}@github.com/axelvaldez/axel.mx.git`;

        // Generate filename and content
        const date = new Date();
        date.setHours(date.getHours() - 7); // Convert to GMT-7
        const filename = date.toISOString().replace(/[:.]/g, '-').slice(0, 16);
        const filePath = path.join('_src', 'updates', `${filename}.md`);

        let markdownContent = `---
title: ${filename}
date: ${date.toISOString()}
permalink: "updates/{{ page.date | date: '%Y%m%d%H%M%S' }}/index.html"
---\n`;

        // Handle image if uploaded
        if (imageBuffer) {
            console.log('Processing image upload');
            const imageFilename = `${Date.now()}-${Math.round(Math.random() * 1E9)}.jpg`;
            const imagePath = path.join('assets', 'img', 'uploads', imageFilename);
            const imageMarkdown = `<p><img src="/${imagePath}" alt="Uploaded image"></p>\n\n`;
            
            if (imagePosition === 'above') {
                markdownContent += imageMarkdown + content;
            } else {
                markdownContent += content + '\n\n' + imageMarkdown;
            }

            // Create temp directory and clone repo
            if (fs.existsSync(tempDir)) {
                rimraf.sync(tempDir);
            }
            fs.mkdirSync(tempDir);
            
            console.log('Cloning repository');
            const git = simpleGit(tempDir);
            await git.clone(targetRepo, tempDir);
            
            // Write markdown file
            const fullFilePath = path.join(tempDir, filePath);
            fs.mkdirSync(path.dirname(fullFilePath), { recursive: true });
            fs.writeFileSync(fullFilePath, markdownContent);

            // Write image file
            const targetImagePath = path.join(tempDir, '_src', 'assets', 'img', 'uploads', imageFilename);
            fs.mkdirSync(path.dirname(targetImagePath), { recursive: true });
            fs.writeFileSync(targetImagePath, imageBuffer);

            // Configure git and commit
            console.log('Configuring git and committing changes');
            await git.addConfig('user.name', 'VibeCoding Bot');
            await git.addConfig('user.email', 'bot@vibecoding.com');
            await git.add('.');
            
            const status = await git.status();
            if (status.files.length > 0) {
                await git.commit(`Add update ${filename}`);
                await git.push('origin', 'main');
            }

            // Clean up
            rimraf.sync(tempDir);

            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, message: 'Update published successfully!' })
            };
        } else {
            console.log('Processing text-only update');
            // Handle text-only update
            if (fs.existsSync(tempDir)) {
                rimraf.sync(tempDir);
            }
            fs.mkdirSync(tempDir);
            
            console.log('Cloning repository');
            const git = simpleGit(tempDir);
            await git.clone(targetRepo, tempDir);
            
            const fullFilePath = path.join(tempDir, filePath);
            fs.mkdirSync(path.dirname(fullFilePath), { recursive: true });
            fs.writeFileSync(fullFilePath, markdownContent + content);

            console.log('Configuring git and committing changes');
            await git.addConfig('user.name', 'VibeCoding Bot');
            await git.addConfig('user.email', 'bot@vibecoding.com');
            await git.add('.');
            
            const status = await git.status();
            if (status.files.length > 0) {
                await git.commit(`Add update ${filename}`);
                await git.push('origin', 'main');
            }

            rimraf.sync(tempDir);

            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, message: 'Update published successfully!' })
            };
        }
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