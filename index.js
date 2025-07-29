const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const db = require("./database");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.set("view engine", "ejs");

app.use(
    session({
        secret: "your-secret-key",
        resave: false,
        saveUninitialized: true,
    })
);

// Sanitize file names
function sanitizeFileName(fileName) {
    let sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "").trim();
    const extension = path.extname(sanitizedFileName).toLowerCase();
    if (extension !== ".pdf") {
        sanitizedFileName = `${path.basename(sanitizedFileName, extension)}.pdf`;
    }
    if (sanitizedFileName.length > 255) {
        const nameWithoutExtension = path.basename(sanitizedFileName, ".pdf");
        sanitizedFileName = `${nameWithoutExtension.slice(0, 255 - 4)}.pdf`;
    }
    return sanitizedFileName;
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "public/pdfs");
    },
    filename: function (req, file, cb) {
        const name = sanitizeFileName(file.originalname);
        cb(null, Date.now() + "-" + name);
    },
});

const fileFilter = (req, file, cb) => {
    // Accept only PDF files
    if (file.mimetype === "application/pdf") {
        cb(null, true);
    } else {
        cb(new Error("Only PDF files are allowed"), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB size limit
});

const checkAuth = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        res.redirect("/login");
    }
};

// Home route
app.get("/", (req, res) => {
    const activeCategory = req.query.c || "";
    db.all(`SELECT * FROM category ORDER BY position ASC, id ASC`, (err, categories) => {
        if (err) {
            console.error("Error retrieving categories:", err);
            return res.status(500).send("Error retrieving categories");
        }

        // Helper function to build category hierarchy while maintaining position order
        const buildCategoryHierarchy = (categories, pdfs = []) => {
            const categoryMap = categories.reduce((acc, category) => {
                category.hasPdfs = false; // Initialize hasPdfs flag
                category.children = []; // Initialize children array for all categories
                acc[category.id] = category;
                return acc;
            }, {});

            // Mark categories that have PDFs
            pdfs.forEach((pdf) => {
                pdf.name = pdf.name.replace(".pdf", "");
                if (categoryMap[pdf.category_id]) {
                    categoryMap[pdf.category_id].hasPdfs = true;
                }
            });

            // Build parent-child relationships
            Object.keys(categoryMap).forEach((key) => {
                const category = categoryMap[key];
                if (category.parent_id) {
                    const parentCategory = categoryMap[category.parent_id];
                    if (parentCategory) {
                        parentCategory.children.push(category);
                    }
                }
            });

            // Sort children arrays by position
            Object.values(categoryMap).forEach((category) => {
                if (category.children && category.children.length > 0) {
                    category.children.sort((a, b) => {
                        // First sort by position, then by id as fallback
                        if (a.position !== b.position) {
                            return a.position - b.position;
                        }
                        return a.id - b.id;
                    });
                }
            });

            // Filter to only include top-level categories and sort them
            const topLevelCategories = Object.values(categoryMap)
                .filter((category) => !category.parent_id)
                .sort((a, b) => {
                    // First sort by position, then by id as fallback
                    if (a.position !== b.position) {
                        return a.position - b.position;
                    }
                    return a.id - b.id;
                });

            return topLevelCategories;
        };

        let categoryId = null;
        let childCategoryIds = [];

        if (categories && categories.length > 0) {
            let activeCatItem = categories.find((item) => item.name === activeCategory);
            categoryId = activeCatItem ? activeCatItem.id : null;
            if (categoryId) {
                // Find all children of the selected parent category
                childCategoryIds = categories.filter((category) => category.parent_id === categoryId).map((category) => category.id);
            }
        }

        // Fetch PDFs for active category and its children
        if (activeCategory && categoryId) {
            let pdfQuery = `SELECT * FROM pdf WHERE isPublic = 1 AND (category_id = ? OR category_id IN (${childCategoryIds
                .map(() => "?")
                .join(",")}))`;
            let pdfParams = [categoryId, ...childCategoryIds];

            db.all(pdfQuery, pdfParams, (err, pdfs) => {
                if (err) {
                    console.error("Error retrieving PDFs:", err);
                    return res.status(500).send("Error retrieving PDFs");
                }

                const structuredCategories = buildCategoryHierarchy(categories, pdfs);

                res.render("public", {
                    categories: structuredCategories || [],
                    pdfs: pdfs || [],
                    activeCategory: activeCategory ? activeCategory : null,
                });
            });
        } else {
            // No active category - build hierarchy without PDFs
            const structuredCategories = buildCategoryHierarchy(categories);

            res.render("public", {
                categories: structuredCategories || [],
                activeCategory: null,
                pdfs: [],
            });
        }
    });
});

// Update the login routes in index.js
app.get("/login", (req, res) => {
    res.render("login", { error: null }); // Pass error as null initially
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    console.log(req.body);
    if (username === "id_admin" && password === "Indo$Gulf@309") {
        console.log("admin");
        req.session.user = { username };
        res.redirect("/category");
    } else {
        res.render("login", { error: "Invalid username or password" }); // Pass error message
    }
});

// Logout route
app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login");
});

// Category management routes
// GET route to render category management page
app.get("/category", checkAuth, (req, res) => {
    db.all("SELECT * FROM category ORDER BY parent_id ASC, position ASC", (err, rows) => {
        if (err) {
            console.error("Error retrieving categories:", err);
            return res.status(500).send("Error retrieving categories");
        }

        // Organize categories into parent-child hierarchy
        const categories = [];
        const parentMap = {};
        rows.forEach((row) => {
            if (row.parent_id === null) {
                // This is a parent category
                parentMap[row.id] = {
                    ...row,
                    children: [],
                    hasChildren: false,
                };
                categories.push(parentMap[row.id]);
            } else {
                // This is a subcategory
                if (parentMap[row.parent_id]) {
                    parentMap[row.parent_id].children.push(row);
                    parentMap[row.parent_id].hasChildren = true;
                }
            }
        });

        // Update categories to include hasPdfs flag
        const categoryIds = rows.map((row) => row.id);
        const pdfQuery = "SELECT DISTINCT category_id FROM pdf WHERE category_id IN (" + categoryIds.join(",") + ") AND isPublic = 1";
        db.all(pdfQuery, (err, pdfCategories) => {
            if (err) {
                console.error("Error retrieving PDF categories:", err);
                return res.status(500).send("Error retrieving PDF categories");
            }
            pdfCategories.forEach((pdfCategory) => {
                const categoryId = pdfCategory.category_id;
                categories.forEach((category) => {
                    if (category.id === categoryId) {
                        category.hasPdfs = true;
                    }
                });
            });

            res.render("category2", { categories });
        });
    });
});

app.post("/category/add", checkAuth, (req, res) => {
    const { name, parent_id } = req.body;
    db.run("INSERT INTO category (name, parent_id) VALUES (?, ?)", [name, parent_id || null], (err) => {
        if (err) {
            console.error("Error adding category:", err);
            return res.status(500).send("Error adding category");
        }
        res.redirect("/category");
    });
});

// POST route to handle category reordering
app.post("/category/reorder", checkAuth, (req, res) => {
    const { orderedIds, newParentId } = req.body;
    let position = 0;

    if (orderedIds) {
        orderedIds.forEach((id, index) => {
            // Determine the parent_id based on newParentId or default to null
            const parent_id = newParentId === "null" ? null : newParentId;

            // Update position and parent_id in the database for each category
            db.run("UPDATE category SET position = ?, parent_id = ? WHERE id = ?", [position++, parent_id, id], (err) => {
                if (err) {
                    console.error("Error reordering categories:", err);
                }
            });
        });
    }

    res.sendStatus(200);
});

// POST route to handle updating a category
app.post("/category/update", checkAuth, (req, res) => {
    const { id, name, parent_id } = req.body;

    // Construct the SQL query and parameters based on whether parent_id is provided
    let query = "UPDATE category SET name = ?";
    let params = [name];

    console.log(id, name, typeof parent_id);

    if (req.body.hasOwnProperty("parent_id")) {
        query += ", parent_id = ?";
        params.push(parent_id);
    }

    query += " WHERE id = ?";
    params.push(id);

    db.run(query, params, (err) => {
        if (err) {
            console.error("Error updating category:", err);
            return res.status(500).send("Error updating category");
        }
        res.redirect("/category");
    });
});

// POST route to handle deleting a category
app.post("/category/delete", checkAuth, (req, res) => {
    const { id } = req.body;
    db.run("DELETE FROM category WHERE id = ?", [id], (err) => {
        if (err) {
            console.error("Error deleting category:", err);
            return res.status(500).send("Error deleting category");
        }
        res.redirect("/category");
    });
});

// POST route to handle converting subcategory to parent category
app.post("/category/updateParent", checkAuth, (req, res) => {
    const { id, parent_id } = req.body;
    db.run("UPDATE category SET parent_id = ? WHERE id = ?", [parent_id, id], (err) => {
        if (err) {
            console.error("Error updating parent category:", err);
            return res.status(500).send("Error updating parent category");
        }
        res.redirect("/category");
    });
});

// Upload PDFs route
app.get("/upload", checkAuth, (req, res) => {
    db.all(`SELECT * FROM category ORDER BY position ASC`, (err, categories) => {
        if (err) {
            console.error("Error retrieving categories:", err);
            return res.status(500).send("Error retrieving categories");
        }
        db.all("SELECT * FROM pdf", (err, pdfs) => {
            if (err) {
                console.error("Error retrieving PDFs:", err);
                return res.status(500).send("Error retrieving PDFs");
            }
            // Map PDFs to categories
            const categoryMap = categories.reduce((acc, category) => {
                category.hasPdfs = false; // Initialize hasPdfs flag
                category.pdfs = [];
                category.children = []; // Initialize children for ALL categories
                acc[category.id] = category;
                return acc;
            }, {});

            pdfs.forEach((pdf) => {
                pdf.name = pdf.name.replace(".pdf", "");
                if (categoryMap[pdf.category_id]) {
                    categoryMap[pdf.category_id].hasPdfs = true;
                    categoryMap[pdf.category_id].pdfs.push(pdf);
                }
            });

            // Build parent-child relationships
            Object.keys(categoryMap).forEach((key) => {
                const category = categoryMap[key];
                if (category.parent_id && categoryMap[category.parent_id]) {
                    categoryMap[category.parent_id].children.push(category);
                }
            });

            // Filter to only include top-level categories
            const structuredCategories = Object.values(categoryMap).filter((category) => !category.parent_id);

            res.render("upload2", {
                categories: structuredCategories || [],
            });
        });
    });
});

app.post("/upload", checkAuth, upload.single("pdf"), (req, res) => {
    const { category_id, isPublic, isPrintable, isDownloadable, isDisclaimer } = req.body;
    const pdfPath = req.file.filename;
    db.run(
        "INSERT INTO pdf (name, path, isPublic, isPrintable, isDownloadable, isDisclaimer, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [req.file.originalname, pdfPath, isPublic ? 1 : 0, isPrintable ? 1 : 0, isDownloadable ? 1 : 0, isDisclaimer ? 1 : 0, category_id],
        (err) => {
            if (err) {
                console.error("Error uploading PDF:", err);
                return res.status(500).send("Error uploading PDF");
            }
            res.redirect("/upload");
        }
    );
});

// POST route to handle updating an existing PDF
app.post("/upload/update", checkAuth, multer().none(), (req, res) => {
    const { pdfId, isPublic, isPrintable, isDownloadable, isDisclaimer, category_id } = req.body;

    console.log(category_id);

    const query = "UPDATE pdf SET isPublic = ?, isPrintable = ?, isDownloadable = ?, isDisclaimer = ?, category_id = ? WHERE id = ?";
    const params = [isPublic ? 1 : 0, isPrintable ? 1 : 0, isDownloadable ? 1 : 0, isDisclaimer ? 1 : 0, category_id, pdfId];

    console.log(req.body);

    db.run(query, params, (err) => {
        if (err) {
            console.error("Error updating PDF:", err);
            return res.status(500).send("Error updating PDF");
        }
        res.redirect("/upload");
    });
});

app.post("/upload/delete", checkAuth, (req, res) => {
    const { id } = req.body;
    db.get("SELECT path FROM pdf WHERE id = ?", [id], (err, row) => {
        if (err) {
            console.error("Error retrieving PDF path:", err);
            return res.status(500).send("Error retrieving PDF path");
        }
        const pdfPath = path.join(__dirname, "public/pdfs", row.path);
        fs.unlink(pdfPath, (err) => {
            if (err) {
                console.error("Error deleting PDF file:", err);
                return res.status(500).send("Error deleting PDF file");
            }
            db.run("DELETE FROM pdf WHERE id = ?", [id], (err) => {
                if (err) {
                    console.error("Error deleting PDF record:", err);
                    return res.status(500).send("Error deleting PDF record");
                }
                res.redirect("/upload");
            });
        });
    });
});

app.get("/view", (req, res) => {
    const pdfPath = req.query.file;
    db.get("SELECT * FROM pdf WHERE path = ?", [pdfPath], (err, pdf) => {
        if (err) {
            console.error("Error retrieving PDF:", err);
            return res.status(500).send("Error retrieving PDF");
        }
        if (!pdf) {
            return res.status(404).send("PDF not found");
        }
        // res.sendFile(path.join(__dirname, "public/viewer/web", "viewer.html"));
        res.render("viewer", { pdf });
    });
});

// New route for downloading files with disclaimer check
app.get("/download", (req, res) => {
    const pdfPath = req.query.file;
    db.get("SELECT * FROM pdf WHERE path = ?", [pdfPath], (err, pdf) => {
        if (err) {
            console.error("Error retrieving PDF:", err);
            return res.status(500).send("Error retrieving PDF");
        }
        if (!pdf) {
            return res.status(404).send("PDF not found");
        }
        if (!pdf.isDownloadable) {
            return res.status(403).send("Download not allowed for this file");
        }

        const filePath = path.join(__dirname, "public/pdfs", pdf.path);
        res.download(filePath, pdf.name);
    });
});

app.listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
});
