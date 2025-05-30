require('dotenv').config(); // Load environment variables from .env
const express = require('express');
const multer = require('multer');
const path = require('path');
const mysql = require('mysql2/promise'); // Using promise-based API for async/await
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000; // Server will run on port 3000

// --- MIDDLEWARE ---
// These app.use() lines tell Express how to process incoming requests.
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true }));

// Serve static files from the root of your frontend (Yumolgy-web-site folder)
// This makes files like index.html, Upload.html, recipes.html accessible directly.
app.use(express.static(path.join(__dirname, '../')));

// Serve uploaded images via a dedicated URL path (e.g., /uploaded_images)
// These files are physically located in Yumolgy-web-site/server/uploads
app.use('/uploaded_images', express.static(path.join(__dirname, 'uploads')));

// --- NEW ROUTE: Serve index.html for the root URL ---
// This handles requests to http://localhost:3000/
app.get('/', (req, res) => {
    // THIS LINE IS CHANGED BACK to send the index.html file
    res.sendFile(path.join(__dirname, '../index.html'));
});

// --- MULTER STORAGE CONFIGURATION ---
// This block must come BEFORE any routes that use 'upload', and before app.listen().
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Save files to the 'uploads' directory directly within the 'server' directory
        // __dirname refers to the current directory of the server.js file
        cb(null, path.join(__dirname, 'uploads/'));
    },
    filename: function (req, file, cb) {
        // Generate a unique filename to prevent overwrites
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });


// --- DATABASE CONNECTION POOL ---
// This needs to be defined early so routes can use it.
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, // <<< THIS LINE IS THE KEY
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
pool.getConnection()
    .then(connection => {
        console.log('Katea');
        connection.release(); // Release the connection back to the pool
    })
    .catch(err => {
        console.error('Error connecting to MySQL:', err);
    });


// --- API ENDPOINTS ---
// All your app.post (or app.get) routes go here, after middleware and setup.

// Register User
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        // Check if user already exists
        const [existingUsers] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(409).json({ message: 'Email already registered.' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10); // 10 is the salt rounds

        // Insert new user into database
        const [result] = await pool.execute(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );

        res.status(201).json({ message: 'User registered successfully!', userId: result.insertId });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// Login User
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    try {
        // Retrieve user from database
        const [users] = await pool.execute('SELECT id, name, password FROM users WHERE email = ?', [email]);

        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const user = users[0];

        // Compare provided password with hashed password
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        // If login successful, you might want to return a token here for future authentication
        res.status(200).json({ message: 'Login successful!', userId: user.id, userName: user.name });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

// --- NEW RECIPE CREATION ROUTE ---
app.post('/recipes', upload.single('recipeImage'), async (req, res) => {
    try {
        // Access text fields from req.body
        const { name, prep_time, cooking_time, tags, description, ingredients, directions, calories, total_fat, protein, carbohydrate, cholesterol, allergens } = req.body;

        // Get the path to the uploaded image (if available)
        // This 'imageUrl' will be stored in the database.
        const imageUrl = req.file ? `/uploaded_images/${req.file.filename}` : null;

        // --- IMPORTANT: Handling user_id ---
        // For now, using a placeholder user_id = 5.
        // In a real application, after successful login, you would store the user's ID
        // (e.g., in a session variable or a JWT token) and retrieve it here.
        // Example: const userId = req.session.userId; // If you implement sessions
        const userId = 5; // Placeholder: ENSURE a user with ID 5 exists in your 'users' table for testing!

        // Basic validation (add more as needed for all fields)
        if (!name || !ingredients || !directions || !userId) {
            return res.status(400).json({ message: 'Missing required recipe fields: name, ingredients, directions, or user_id.' });
        }

        // Insert recipe into database
        const [result] = await pool.execute(
            `INSERT INTO recipes (user_id, name, prep_time, cooking_time, tags, description, ingredients, directions, calories, total_fat, protein, carbohydrate, cholesterol, allergens, image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, name, prep_time, cooking_time, tags, description, ingredients, directions, calories, total_fat, protein, carbohydrate, cholesterol, allergens, imageUrl]
        );

        res.status(201).json({ message: 'Recipe created successfully!', recipeId: result.insertId, imageUrl: imageUrl });

    } catch (error) {
        console.error('Error creating recipe:', error);
        // More specific error messages can be added here based on 'error.code'
        res.status(500).json({ message: 'Failed to create recipe. Please try again.' });
    }
});


// --- START THE SERVER ---
// This should always be the last part of your server.js file.
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});