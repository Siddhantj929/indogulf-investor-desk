const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("db.sqlite");

// Define the desired order
const categoryOrder = [
    { name: "DRHP", position: 0 },
    { name: "RHP", position: 1 },
    { name: "Abridged Prospectus", position: 2 },
    { name: "Annual Return", position: 4 },
    { name: "Codes and Policies", position: 5 },
    { name: "Financial Statement", position: 6 },
    { name: "Shareholding Pattern", position: 7 },
    { name: "Corrigendum", position: 3 }
];

// Function to shift existing categories
function shiftExistingCategories(callback) {
    console.log("Shifting existing categories to make room...");
    
    // First, shift all categories with position >= 0 by 3 positions
    db.run("UPDATE category SET position = position + 3 WHERE position >= 0", (err) => {
        if (err) {
            console.error("Error shifting categories:", err);
            callback(err);
        } else {
            console.log("✓ Shifted existing categories");
            callback(null);
        }
    });
}

// Function to update or create categories
function updateOrCreateCategories(callback) {
    let processed = 0;
    
    categoryOrder.forEach(({ name, position }) => {
        // First check if category exists
        db.get("SELECT id FROM category WHERE name = ?", [name], (err, row) => {
            if (err) {
                console.error(`Error checking ${name}:`, err);
                processed++;
            } else if (row) {
                // Category exists, update its position
                db.run("UPDATE category SET position = ? WHERE name = ?", 
                    [position, name], 
                    (err) => {
                        if (err) {
                            console.error(`Error updating ${name}:`, err);
                        } else {
                            console.log(`✓ Updated "${name}" to position ${position}`);
                        }
                        processed++;
                        if (processed === categoryOrder.length) callback();
                    }
                );
            } else {
                // Category doesn't exist, create it
                db.run("INSERT INTO category (name, position, parent_id) VALUES (?, ?, NULL)", 
                    [name, position], 
                    (err) => {
                        if (err) {
                            console.error(`Error creating ${name}:`, err);
                        } else {
                            console.log(`✓ Created "${name}" at position ${position}`);
                        }
                        processed++;
                        if (processed === categoryOrder.length) callback();
                    }
                );
            }
        });
    });
}

// Function to verify the new order
function verifyOrder() {
    console.log("\n=== Verifying new order ===");
    db.all("SELECT name, position, parent_id FROM category WHERE parent_id IS NULL ORDER BY position ASC", (err, rows) => {
        if (err) {
            console.error("Error verifying order:", err);
        } else {
            console.log("\nAll parent categories by position:");
            rows.forEach((row, index) => {
                const marker = categoryOrder.find(c => c.name === row.name) ? "★" : " ";
                console.log(`${marker} ${index + 1}. ${row.name} (position: ${row.position})`);
            });
        }
        db.close();
        console.log("\n✅ Script completed!");
    });
}

// Main execution
console.log("Starting category order update script...\n");

db.serialize(() => {
    // Option 1: Simple update (uncomment this if you just want to update existing categories)
    // updateOrCreateCategories(() => {
    //     verifyOrder();
    // });
    
    // Option 2: Shift and update (uncomment this if you want to ensure these are the first 3)
    shiftExistingCategories((err) => {
        if (err) {
            db.close();
            return;
        }
        updateOrCreateCategories(() => {
            verifyOrder();
        });
    });
});

// Handle errors
db.on('error', (err) => {
    console.error('Database error:', err);
});
