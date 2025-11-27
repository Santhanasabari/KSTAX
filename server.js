// Middleware to parse JSON bodies
app.use(express.json());

// --- DATABASE CONNECTION (REPLACE WITH YOUR DETAILS) ---
// This is the critical part you need to configure correctly.
const db = mysql.createConnection({
    host: 'localhost',                 // Usually 'localhost'
    user: 'root',                      // Your MySQL username (often 'root')
    password: 'your_database_password', // <-- IMPORTANT: Change to your MySQL password
    database: 'tax_solution_db'        // <-- IMPORTANT: Change to the name of the database you created
});

db.connect(err => {
    if (err) {
        console.error('Error connecting to database:', err);
        return;
    }
    console.log('Connected to database');
});