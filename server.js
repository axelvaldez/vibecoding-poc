const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const session = require('express-session');
const os = require('os');
const rimraf = require('rimraf');
const helmet = require('helmet');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = ['GITHUB_PAT', 'ADMIN_PASSWORD', 'SESSION_SECRET'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://u.axel.mx'] 
        : ['http://localhost:3000'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Configure body parser
app.use(bodyParser.json({ limit: '10kb' })); // Limit payload size
app.use(express.static('public'));
app.use(limiter);

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(os.tmpdir(), 'vibecoding-temp-uploads');
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Only JPG and PNG files are allowed'));
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// Login endpoint
app.post('/login', async (req, res) => {
    const { password } = req.body;
    
    if (!password) {
        return res.status(400).json({ error: 'Password is required' });
    }
    
    try {
        console.log('Login attempt with password:', password ? 'provided' : 'missing');
        console.log('Environment variables loaded:', {
            hasAdminPassword: !!process.env.ADMIN_PASSWORD,
            hasSessionSecret: !!process.env.SESSION_SECRET,
            nodeEnv: process.env.NODE_ENV,
            allowedOrigin: process.env.ALLOWED_ORIGIN
        });

        const match = await bcrypt.compare(password, process.env.ADMIN_PASSWORD);
        console.log('Password match:', match);
        
        if (match) {
            req.session.authenticated = true;
            res.json({ success: true });
        } else {
            // Add delay to prevent timing attacks
            await new Promise(resolve => setTimeout(resolve, 500));
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Check auth status
app.get('/auth-status', (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
});

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

app.post('/publish', requireAuth, upload.single('image'), async (req, res) => {
    const tempDir = path.join(os.tmpdir(), 'vibecoding-temp');
    const targetRepo = 'https://github.com/axelvaldez/axel.mx.git';
    
    try {
        const { content, imagePosition } = req.body;
        
        // Validate content
        if (!content || typeof content !== 'string' || content.length > 10000) {
            return res.status(400).json({ error: 'Invalid content' });
        }
        
        const filename = generateFilename();
        const filePath = path.join('_src', 'updates', `${filename}.md`);
        
        // Create markdown content with image if present
        let markdownContent = `---
title: ${filename}
date: ${getCurrentDate()}
permalink: "updates/{{ page.date | date: '%Y%m%d%H%M%S' }}/index.html"
---
`;

        if (req.file) {
            const imageMarkdown = `<p><img src="/assets/img/uploads/${path.basename(req.file.path)}"></p>`;
            markdownContent += imagePosition === 'above' ? imageMarkdown + '\n\n' + content : content + '\n\n' + imageMarkdown;
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

        // Configure git for the target repo
        await git.addConfig('user.name', 'VibeCoding Bot');
        await git.addConfig('user.email', 'bot@vibecoding.com');

        // Stage the new file and image if present
        await git.add(filePath);
        if (req.file) {
            const imagePath = path.join('_src', 'assets', 'img', 'uploads', path.basename(req.file.path));
            const fullImagePath = path.join(tempDir, imagePath);
            // Ensure the uploads directory exists in the repo
            fs.mkdirSync(path.dirname(fullImagePath), { recursive: true });
            // Copy the uploaded file to the repo
            fs.copyFileSync(req.file.path, fullImagePath);
            await git.add(imagePath);
        }
        
        // Check if there are any changes to commit
        const status = await git.status();
        if (status.files.length > 0) {
            await git.commit(`Add update ${filename}`);
            await git.push('origin', 'main');
        }

        // Clean up
        rimraf.sync(tempDir);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path); // Clean up the uploaded file
        }

        res.json({ success: true, message: 'Update published successfully!' });
    } catch (error) {
        console.error('Error:', error);
        // Clean up in case of error
        if (fs.existsSync(tempDir)) {
            rimraf.sync(tempDir);
        }
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ 
            success: false, 
            message: 'Failed to publish update. Please try again.' 
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`Server running`);
}); 