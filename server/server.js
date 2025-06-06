const { stringify } = require('csv-stringify'); // Import csv-stringify
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../')));
app.use('/uploaded_images', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, 'uploads/');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

pool.getConnection()
    .then(connection => {
        console.log('Katea');
        connection.release();
    })
    .catch(err => {
        console.error('Error connecting to MySQL:', err);
    });

app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required.' });
    }
    try {
        const [existingUsers] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(409).json({ message: 'Email already registered.' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
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

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }
    try {
        const [users] = await pool.execute('SELECT id, name, password, description, favorite_tags, profile_image_url FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }
        const user = users[0];
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }
        res.status(200).json({
            message: 'Login successful!',
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            userDescription: user.description || '',
            userFavoriteTags: user.favorite_tags || '',
            userProfileImageUrl: user.profile_image_url || ''
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

app.get('/profile/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const [users] = await pool.execute(
            'SELECT id, name, email, description, favorite_tags, profile_image_url FROM users WHERE id = ?',
            [userId]
        );
        if (users.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        const user = users[0];
        const [myRecipes] = await pool.execute(
            'SELECT id, name, prep_time, cooking_time, tags, image_url FROM recipes WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );
        const savedRecipes = [];
        res.status(200).json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                description: user.description || '',
                favoriteTags: user.favorite_tags || '',
                profileImageUrl: user.profile_image_url || ''
            },
            myRecipes: myRecipes,
            savedRecipes: savedRecipes,
            postsCount: myRecipes.length
        });
    } catch (error) {
        console.error('Error fetching profile data:', error);
        res.status(500).json({ message: 'Failed to fetch profile data.' });
    }
});

app.put('/profile/:userId', upload.single('profilePicture'), async (req, res) => {
    const { userId } = req.params;
    const { name, email, description, favoriteTags, password } = req.body;
    const profilePictureFile = req.file;
    if (!userId) {
        return res.status(400).json({ message: 'User ID is required.' });
    }
    let newProfileImageUrl = null;
    let updateFields = [];
    let queryParams = [];
    if (name) {
        updateFields.push('name = ?');
        queryParams.push(name);
    }
    if (email) {
        updateFields.push('email = ?');
        queryParams.push(email);
    }
    if (description !== undefined) {
        updateFields.push('description = ?');
        queryParams.push(description);
    }
    if (favoriteTags !== undefined) {
        updateFields.push('favorite_tags = ?');
        queryParams.push(favoriteTags);
    }
    try {
        if (profilePictureFile) {
            newProfileImageUrl = `/uploaded_images/${profilePictureFile.filename}`;
            const [oldUser] = await pool.execute('SELECT profile_image_url FROM users WHERE id = ?', [userId]);
            if (oldUser.length > 0 && oldUser[0].profile_image_url) {
                const oldImagePath = path.join(__dirname, oldUser[0].profile_image_url.replace('/uploaded_images/', 'uploads/'));
                if (fs.existsSync(oldImagePath)) {
                    fs.unlink(oldImagePath, (err) => {
                        if (err) console.error('Error deleting old profile image:', err);
                        else console.log('Old profile image deleted:', oldImagePath);
                    });
                }
            }
            updateFields.push('profile_image_url = ?');
            queryParams.push(newProfileImageUrl);
        }
        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateFields.push('password = ?');
            queryParams.push(hashedPassword);
        }
        if (updateFields.length === 0) {
            return res.status(400).json({ message: 'No fields provided for update.' });
        }
        const sql = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
        queryParams.push(userId);
        const [result] = await pool.execute(sql, queryParams);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found or no changes made.' });
        }
        const [updatedUsers] = await pool.execute(
            'SELECT id, name, email, description, favorite_tags, profile_image_url FROM users WHERE id = ?',
            [userId]
        );
        const updatedUser = updatedUsers[0];
        res.status(200).json({
            message: 'Profile updated successfully!',
            user: {
                id: updatedUser.id,
                name: updatedUser.name,
                email: updatedUser.email,
                description: updatedUser.description || '',
                favoriteTags: updatedUser.favorite_tags || '',
                profileImageUrl: updatedUser.profile_image_url || ''
            }
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ message: 'Failed to update profile. Server error.' });
    }
});

app.post('/recipes', upload.fields([
    { name: 'recipeImage', maxCount: 1 },
    { name: 'directionImages', maxCount: 10 }
]), async (req, res) => {
    try {
        const { name, prep_time, cooking_time, tags, description, ingredients, directions, calories, total_fat, protein, carbohydrate, cholesterol, allergens, userId } = req.body;
        const recipeImageFile = req.files && req.files['recipeImage'] ? req.files['recipeImage'][0] : null;
        const directionImageFiles = req.files && req.files['directionImages'] ? req.files['directionImages'] : [];
        const imageUrl = recipeImageFile ? `/uploaded_images/${recipeImageFile.filename}` : null;
        const directionImageUrls = directionImageFiles.map(file => `/uploaded_images/${file.filename}`);
        if (!userId) {
            return res.status(400).json({ message: 'User ID is required to create a recipe.' });
        }
        if (!name || !ingredients || !directions) {
            return res.status(400).json({ message: 'Missing required recipe fields: name, ingredients, or directions.' });
        }
        const [result] = await pool.execute(
            `INSERT INTO recipes (user_id, name, prep_time, cooking_time, tags, description, ingredients, directions, calories, total_fat, protein, carbohydrate, cholesterol, allergens, image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, name, prep_time, cooking_time, tags, description, ingredients, directions, calories, total_fat, protein, carbohydrate, cholesterol, allergens, imageUrl]
        );
        res.status(201).json({ message: 'Recipe created successfully!', recipeId: result.insertId, imageUrl: imageUrl, directionImageUrls: directionImageUrls });
    } catch (error) {
        console.error('Error creating recipe:', error);
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ message: 'Too many files or unexpected file field. Please check your file inputs.' });
            }
        }
        res.status(500).json({ message: 'Failed to create recipe. Please try again.' });
    }
});

app.get('/recipes/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [recipes] = await pool.execute(
            `SELECT r.*, u.name as author_name
             FROM recipes r
             JOIN users u ON r.user_id = u.id
             WHERE r.id = ?`,
            [id]
        );
        if (recipes.length === 0) {
            return res.status(404).json({ message: 'Recipe not found.' });
        }
        const recipe = recipes[0];
        res.status(200).json({ recipe });
    } catch (error) {
        console.error('Error fetching single recipe:', error);
        res.status(500).json({ message: 'Failed to fetch recipe details. Server error.' });
    }
});

app.get('/recipes', async (req, res) => {
    const searchQuery = req.query.search;
    let sql = `SELECT r.id, r.name, r.prep_time, r.cooking_time, r.tags, r.image_url, u.name as author_name
               FROM recipes r
               JOIN users u ON r.user_id = u.id`;
    let queryParams = [];
    if (searchQuery) {
        sql += ` WHERE r.name LIKE ? OR r.description LIKE ? OR r.tags LIKE ?`;
        const searchTerm = `%${searchQuery}%`;
        queryParams.push(searchTerm, searchTerm, searchTerm);
    }
    sql += ` ORDER BY r.created_at DESC`;
    try {
        const [recipes] = await pool.execute(sql, queryParams);
        res.status(200).json({ recipes });
    } catch (error) {
        console.error('Error fetching all recipes:', error);
        res.status(500).json({ message: 'Failed to fetch recipes. Server error.' });
    }
});

app.delete('/recipes/:id', async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized: User ID is required for deletion.' });
    }
    try {
        const [recipe] = await pool.execute('SELECT user_id, image_url FROM recipes WHERE id = ?', [id]);
        if (recipe.length === 0) {
            return res.status(404).json({ message: 'Recipe not found.' });
        }
        if (recipe[0].user_id !== parseInt(userId)) {
            return res.status(403).json({ message: 'Forbidden: You do not have permission to delete this recipe.' });
        }
        if (recipe[0].image_url) {
            const imagePath = path.join(__dirname, recipe[0].image_url.replace('/uploaded_images/', 'uploads/'));
            if (fs.existsSync(imagePath)) {
                fs.unlink(imagePath, (err) => {
                    if (err) console.error('Error deleting recipe image file:', err);
                    else console.log('Recipe image file deleted:', imagePath);
                });
            }
        }
        const [result] = await pool.execute('DELETE FROM recipes WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Recipe not found or already deleted.' });
        }
        res.status(200).json({ message: 'Recipe deleted successfully!' });
    } catch (error) {
        console.error('Error deleting recipe:', error);
        res.status(500).json({ message: 'Failed to delete recipe. Server error.' });
    }
});

// --- NEW: EXPORT RECIPE AS JSON ENDPOINT ---
app.get('/recipes/:id/export/json', async (req, res) => {
    const { id } = req.params;
    try {
        const [recipes] = await pool.execute(
            `SELECT r.*, u.name as author_name
             FROM recipes r
             JOIN users u ON r.user_id = u.id
             WHERE r.id = ?`,
            [id]
        );

        if (recipes.length === 0) {
            return res.status(404).json({ message: 'Recipe not found.' });
        }

        const recipe = recipes[0];

        // Format data for JSON export (clean up unnecessary fields, format dates)
        const formattedRecipe = {
            id: recipe.id,
            name: recipe.name,
            author: recipe.author_name,
            description: recipe.description,
            ingredients: recipe.ingredients ? recipe.ingredients.split('\n') : [],
            directions: recipe.directions ? recipe.directions.split('\n') : [],
            prep_time_minutes: recipe.prep_time,
            cooking_time_minutes: recipe.cooking_time,
            tags: recipe.tags ? recipe.tags.split(',').map(tag => tag.trim()) : [],
            image_url: recipe.image_url ? `http://localhost:${port}${recipe.image_url}` : null,
            nutrition: {
                calories: recipe.calories,
                total_fat: recipe.total_fat,
                protein: recipe.protein,
                carbohydrate: recipe.carbohydrate,
                cholesterol: recipe.cholesterol,
                allergens: recipe.allergens
            },
            created_at: new Date(recipe.created_at).toISOString()
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${recipe.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${recipe.id}.json"`);
        res.status(200).send(JSON.stringify(formattedRecipe, null, 2)); // Pretty print JSON

    } catch (error) {
        console.error('Error exporting recipe as JSON:', error);
        res.status(500).json({ message: 'Failed to export recipe as JSON. Server error.' });
    }
});

// --- NEW: EXPORT RECIPE AS CSV ENDPOINT ---
app.get('/recipes/:id/export/csv', async (req, res) => {
    const { id } = req.params;
    try {
        const [recipes] = await pool.execute(
            `SELECT r.*, u.name as author_name
             FROM recipes r
             JOIN users u ON r.user_id = u.id
             WHERE r.id = ?`,
            [id]
        );

        if (recipes.length === 0) {
            return res.status(404).json({ message: 'Recipe not found.' });
        }

        const recipe = recipes[0];

        // Prepare data for CSV
        // Flatten the recipe object into a single row for CSV
        const dataForCsv = [{
            id: recipe.id,
            name: recipe.name,
            author: recipe.author_name,
            description: recipe.description,
            ingredients: recipe.ingredients, // Keep as string, or split and join with a different delimiter if needed
            directions: recipe.directions,   // Keep as string
            prep_time_minutes: recipe.prep_time,
            cooking_time_minutes: recipe.cooking_time,
            tags: recipe.tags,
            image_url: recipe.image_url ? `http://localhost:${port}${recipe.image_url}` : '',
            calories: recipe.calories,
            total_fat: recipe.total_fat,
            protein: recipe.protein,
            carbohydrate: recipe.carbohydrate,
            cholesterol: recipe.cholesterol,
            allergens: recipe.allergens,
            created_at: new Date(recipe.created_at).toISOString()
        }];

        // Define columns for CSV
        const columns = Object.keys(dataForCsv[0]).map(key => ({ key: key, header: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }));

        stringify(dataForCsv, { header: true, columns: columns }, (err, output) => {
            if (err) {
                console.error('Error stringifying CSV:', err);
                return res.status(500).json({ message: 'Failed to generate CSV.' });
            }
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${recipe.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${recipe.id}.csv"`);
            res.status(200).send(output);
        });

    } catch (error) {
        console.error('Error exporting recipe as CSV:', error);
        res.status(500).json({ message: 'Failed to export recipe as CSV. Server error.' });
    }
});


// --- START THE SERVER ---
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});