const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');
const os = require('os');
const rimraf = require('rimraf');
const multer = require('multer');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Authentication middleware
const authenticate = async (req, res, next) => {
    const providedPassword = req.headers['x-admin-password'];
    
    if (!providedPassword) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const isValid = await bcrypt.compare(providedPassword, process.env.ADMIN_PASSWORD);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
};

// Configure multer for handling file uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            const uploadDir = path.join(__dirname, '_src', 'assets', 'img', 'uploads');
            fs.mkdirSync(uploadDir, { recursive: true });
            cb(null, uploadDir);
        },
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
    }),
    fileFilter: function (req, file, cb) {
        const allowedTypes = ['image/jpeg', 'image/png'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG and PNG files are allowed.'));
        }
    }
});

// Configure body parser
app.use(bodyParser.json({ limit: '10kb' })); // Limit payload size
app.use(express.static('public'));

// Function to get current date in GMT-7
function getCurrentDate() {
    const date = new Date();
    date.setHours(date.getHours() - 7); // Convert to GMT-7
    return date.toISOString();
}

// Function to generate filename
function generateFilename() {
    const date = new Date();
    date.setHours(date.getHours() - 7); // Convert to GMT-7
    return date.toISOString().replace(/[:.]/g, '-').slice(0, 16);
}

app.post('/publish', authenticate, upload.single('image'), async (req, res) => {
    const tempDir = path.join(os.tmpdir(), 'vibecoding-temp');
    const targetRepo = `https://${process.env.GITHUB_PAT}@github.com/axelvaldez/axel.mx.git`;
    
    try {
        const { content } = req.body;
        
        // Validate content
        if (!content || typeof content !== 'string' || content.length > 10000) {
            return res.status(400).json({ error: 'Invalid content' });
        }
        
        const filename = generateFilename();
        const filePath = path.join('_src', 'updates', `${filename}.md`);
        
        let markdownContent = `---
title: ${filename}
date: ${getCurrentDate()}
permalink: "updates/{{ page.date | date: '%Y%m%d%H%M%S' }}/index.html"
---\n`;

        // Handle image if uploaded
        if (req.file) {
            const imagePosition = req.body.imagePosition || 'below';
            const imagePath = path.join('assets', 'img', 'uploads', req.file.filename);
            const imageMarkdown = `<p><img src="/${imagePath}" alt="Uploaded image"></p>\n\n`;
            
            if (imagePosition === 'above') {
                markdownContent += imageMarkdown + content;
            } else {
                markdownContent += content + '\n\n' + imageMarkdown;
            }
        } else {
            markdownContent += content;
        }

        // Create temp directory and clone repo
        if (fs.existsSync(tempDir)) {
            rimraf.sync(tempDir);
        }
        fs.mkdirSync(tempDir);
        
        const git = simpleGit(tempDir);
        await git.clone(targetRepo, tempDir);
        
        // Write file in the cloned repo
        const fullFilePath = path.join(tempDir, filePath);
        fs.mkdirSync(path.dirname(fullFilePath), { recursive: true });
        fs.writeFileSync(fullFilePath, markdownContent);

        // If there's an image, copy it to the repo
        if (req.file) {
            const sourceImagePath = req.file.path;
            const targetImagePath = path.join(tempDir, '_src', 'assets', 'img', 'uploads', req.file.filename);
            fs.mkdirSync(path.dirname(targetImagePath), { recursive: true });
            
            // Read the image file and ensure it's in the correct format
            const imageBuffer = fs.readFileSync(sourceImagePath);
            fs.writeFileSync(targetImagePath, imageBuffer);
            
            // Clean up the uploaded file
            fs.unlinkSync(sourceImagePath);
        }

        // Configure git for the target repo
        await git.addConfig('user.name', 'VibeCoding Bot');
        await git.addConfig('user.email', 'bot@vibecoding.com');

        // Stage all changes
        await git.add('.');
        
        // Check if there are any changes to commit
        const status = await git.status();
        if (status.files.length > 0) {
            await git.commit(`Add update ${filename}`);
            await git.push('origin', 'main');
        }

        // Clean up
        rimraf.sync(tempDir);

        res.json({ success: true, message: 'Update published successfully!' });
    } catch (error) {
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            command: error.command
        });
        // Clean up in case of error
        if (fs.existsSync(tempDir)) {
            rimraf.sync(tempDir);
        }
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ 
            success: false, 
            message: 'Failed to publish update. Please try again.',
            error: error.message // Include the actual error message
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});