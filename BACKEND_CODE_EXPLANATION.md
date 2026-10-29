# Comprehensive Backend Code Explanation Guide

This guide is designed for absolute beginners to understand the code in the SAP Backend portal. It explains fundamental concepts first, followed by a line-by-line breakdown of the core files:
1. **`server.js`** (The main server entry point)
2. **`models/User.js`** (The database model defining users)
3. **`utils/sendEmail.js`** (The utility sending emails via EmailJS)

---

## Part 1: Quick Glossary of Basic Concepts

Before looking at the code, here are the simple terms used in Node.js and JavaScript:

*   **`const`**: Short for "constant". Used to declare a variable whose value cannot be changed later.
*   **`let`**: Used to declare a variable whose value **can** be changed or updated later in the code.
*   **`require('module_name')`**: Used in Node.js to import code, libraries, or files. It's like bringing in tools from an external toolbox.
*   **`module.exports`**: Used to export functions, variables, or objects from a file so that other files can import them using `require`.
*   **`process.env`**: An object that holds the system's "Environment Variables". These are secret keys (like database links or passwords) stored in a hidden `.env` file instead of directly in the code.
*   **`async` and `await`**:
    *   `async` marks a function as "asynchronous" (meaning it can perform operations that take time, like fetching data from a database or sending an email over the internet).
    *   `await` tells JavaScript to "wait" for that slow operation to finish before moving to the next line.
*   **`try { ... } catch (err) { ... }`**: If the code in the `try` block encounters an error, the server won't crash; instead, it jumps to the `catch` block to handle the error safely.
*   **Arrow Functions (`() => { ... }`)**: A shorter way to write functions. For example, `() => { console.log("Hello") }` is the same as `function() { console.log("Hello") }`.

---

## Part 2: Line-by-Line Breakdown of `server.js`

This file is the **brain and entry point** of the backend. It starts the server, connects to the database, secures the API, and links all routes.

```javascript
1: const express = require("express");
```
*   **What it does**: Imports the `express` library.
*   **Explanation**: Express is a popular framework for building web servers in Node.js. It simplifies handling HTTP requests (like when a browser asks the server for data).

```javascript
2: const mongoose = require("mongoose");
```
*   **What it does**: Imports the `mongoose` library.
*   **Explanation**: Mongoose is a tool that helps our JavaScript code talk to a MongoDB database (a NoSQL database where all our user and points data is stored).

```javascript
3: const cors = require("cors");
```
*   **What it does**: Imports the `cors` (Cross-Origin Resource Sharing) library.
*   **Explanation**: By default, web browsers block web pages from sending requests to a different website or port. CORS allows our frontend (running on one URL) to talk securely to our backend (running on another URL).

```javascript
4: const helmet = require("helmet");
```
*   **What it does**: Imports the `helmet` library.
*   **Explanation**: Helmet is a security middleware. It automatically sets various HTTP headers to protect our app from common web vulnerabilities and hackers.

```javascript
5: const path = require("path");
```
*   **What it does**: Imports the built-in Node.js `path` module.
*   **Explanation**: Used to handle and resolve file system paths (e.g., finding folders on your computer or server).

```javascript
6: const fs = require("fs");
```
*   **What it does**: Imports the built-in Node.js `fs` (File System) module.
*   **Explanation**: Allows our code to read, write, create, or check files and folders on the server's hard drive.

```javascript
7: require("dotenv").config();
```
*   **What it does**: Loads the environment variables from the `.env` file.
*   **Explanation**: Reads key-value pairs from `.env` and loads them into `process.env` so that they can be used throughout the app.

```javascript
12: if (!process.env.JWT_SECRET) {
13:   console.error("❌ FATAL: JWT_SECRET environment variable is not set. Refusing to start.");
14:   process.exit(1);
15: }
```
*   **What it does**: A safety check at startup.
*   *   `!process.env.JWT_SECRET`: Checks if the JSON Web Token secret key is missing (the `!` symbol means NOT).
*   *   `console.error(...)`: Prints a red error message to the server log console.
*   *   `process.exit(1)`: Instantly shuts down the server. The `1` means the server crashed/stopped due to an error.

```javascript
17: const app = express();
```
*   **What it does**: Creates an instance of an Express application.
*   **Explanation**: `app` is the main object we will use to configure our server, routes, and middleware.

```javascript
18: const { apiLimiter } = require("./middleware/rateLimiter");
```
*   **What it does**: Imports `apiLimiter` from our custom rate limiter middleware file.
*   **Explanation**: Used to prevent spam or DDoS attacks by limiting how many requests a single IP address can make.

```javascript
21: const uploadsDir = path.join(__dirname, "uploads");
22: if (!fs.existsSync(uploadsDir)) {
23:   fs.mkdirSync(uploadsDir, { recursive: true });
24: }
```
*   **What it does**: Ensures that a folder named `uploads` exists on the server.
*   *   `__dirname`: A special Node.js variable representing the directory name of the current file.
*   *   `path.join(...)`: Creates the path `sap-backend/uploads`.
*   *   `fs.existsSync(...)`: Checks if the folder already exists.
*   *   `fs.mkdirSync(..., { recursive: true })`: If the folder does not exist, this creates it.

```javascript
27: app.use(helmet());
```
*   **What it does**: Tells Express to use the Helmet security middleware for all incoming requests.

```javascript
34: const rawOrigins = process.env.ALLOWED_ORIGIN
35:   || "https://sap-frontend-lake.vercel.app,http://localhost:5173";
36: const ALLOWED_ORIGINS = new Set(rawOrigins.split(",").map((o) => o.trim()));
```
*   **What it does**: Prepares a list of allowed websites (origins) that are allowed to make requests to our backend.
*   *   `||`: If the environment variable `ALLOWED_ORIGIN` is not defined, it defaults to the strings on the right.
*   *   `.split(",")`: Splits the string by commas into an array.
*   *   `.map((o) => o.trim())`: Trims any accidental spaces around the URLs.
*   *   `new Set(...)`: Converts the list to a "Set" for super-fast lookups later.

```javascript
38: app.use(
39:   cors({
40:     origin: function (origin, callback) {
41:       // Allow same-origin / server-to-server calls (no Origin header)
42:       if (!origin) return callback(null, true);
43:       if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
44:       callback(new Error(`CORS: origin '${origin}' is not allowed`));
45:     },
46:     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
47:     allowedHeaders: ["Content-Type", "Authorization"],
48:     credentials: true,
49:   })
50: );
```
*   **What it does**: Registers the CORS configuration.
*   *   `origin: function(origin, callback)`: Custom check function.
    *   `if (!origin)`: If the request is server-to-server or from inside the same server, allow it.
    *   `ALLOWED_ORIGINS.has(origin)`: If the requesting origin is in our allowed set, allow it by running `callback(null, true)`.
    *   `callback(new Error(...))`: Otherwise, block it and return a CORS error.
*   *   `methods`: Specifies which HTTP methods are permitted.
*   *   `allowedHeaders`: Specifies which headers the frontend can send (like JSON content types or login tokens).
*   *   `credentials: true`: Allows the frontend to send cookies or authentication headers.

```javascript
53: app.use(express.json({ limit: "50kb" }));
54: app.use(express.urlencoded({ extended: true, limit: "50kb" }));
```
*   **What it does**: Tells our server how to read incoming request bodies (payloads).
*   *   `express.json({ limit: "50kb" })`: Allows our server to read JSON bodies, but limits them to a maximum of 50 Kilobytes to prevent hackers from sending massive payloads that slow down our server.
*   *   `express.urlencoded(...)`: Allows our server to read form data.

```javascript
57: app.use("/api", apiLimiter);
```
*   **What it does**: Applies our rate limiter specifically to any URL starting with `/api`.

```javascript
60: app.use("/uploads", express.static(uploadsDir));
```
*   **What it does**: Makes the files inside the `uploads` folder public.
*   **Explanation**: If a user uploads a certificate, the frontend can view/download it by loading a URL like `http://localhost:5001/uploads/certificate.pdf`.

```javascript
63: const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/sap-db";
64: mongoose
65:   .connect(mongoURI)
66:   .then(() => console.log("✅ MongoDB connected successfully!"))
67:   .catch((err) => console.error("❌ MongoDB connection error:", err.message));
```
*   **What it does**: Connects to the MongoDB database.
*   *   `mongoose.connect(...)`: Starts the database connection.
*   *   `.then(...)`: Runs if the connection succeeds (prints a green checkmark).
*   *   `.catch(...)`: Runs if the connection fails (prints a red cross and the error message).

```javascript
72: app.use("/api/auth", require("./routes/authRoutes"));
73: app.use("/api/points", require("./routes/pointsRoutes"));
74: app.use("/api/admin/sap-structure", require("./routes/sapStructureRoutes"));
75: app.use("/api/admin", require("./routes/admin"));
```
*   **What it does**: Mounts our API route files onto specific URLs.
*   *   Any request to `/api/auth/...` goes to `routes/authRoutes.js`.
*   *   Any request to `/api/points/...` goes to `routes/pointsRoutes.js`.
*   *   Any request to `/api/admin/sap-structure/...` goes to `routes/sapStructureRoutes.js`.
*   *   Any request to `/api/admin/...` goes to `routes/admin.js`.

```javascript
78: if (fs.existsSync(path.join(__dirname, "routes", "reportRoutes.js"))) {
79:   app.use("/api/report", require("./routes/reportRoutes"));
80: }
```
*   **What it does**: Checks if `reportRoutes.js` exists in the routes folder. If yes, it mounts it under `/api/report`. This prevents server crashes if the report module is missing.

```javascript
83: app.get("/", (req, res) => {
84:   res.send("SAP Backend API is running smoothly!");
85: });
```
*   **What it does**: A basic health-check endpoint.
*   *   `app.get("/")`: Listens for GET requests on the root URL (e.g. `http://localhost:5001/`).
*   *   `res.send(...)`: Sends back a plain text message confirming the server is alive.

```javascript
90: app.use((err, req, res, next) => {
91:   console.error("[Unhandled error]", err);
92:   res.status(err.status || 500).json({ message: "An unexpected error occurred." });
93: });
```
*   **What it does**: A global error handling middleware.
*   *   If any of the routes or middleware fail, the code automatically redirects here.
*   *   `res.status(500)`: Sets the HTTP status code to 500 (Internal Server Error).
*   *   `res.json(...)`: Sends a clean, generic error message to the client, concealing internal technical logs and stack traces.

```javascript
96: const PORT = process.env.PORT || 5001;
97: app.listen(PORT, () => {
98:   console.log(`🚀 Server running on port ${PORT}`);
99: });
```
*   **What it does**: Starts the server and listens for incoming internet requests on a specific port (like 5001).

---

## Part 3: Line-by-Line Breakdown of `models/User.js`

This file defines the **User Schema** using Mongoose. A Schema is a blueprint or structure that dictates what fields/attributes a User document in MongoDB must contain, and validates them before they are saved.

```javascript
1: const mongoose = require("mongoose");
```
*   **What it does**: Imports the Mongoose database modeling library.

```javascript
3: const AUTHORIZED_ADMIN_EMAIL = process.env.AUTHORIZED_ADMIN_EMAIL || "";
```
*   **What it does**: Loads the specific admin email address allowed in system configurations.

```javascript
5: const userSchema = new mongoose.Schema(
```
*   **What it does**: Creates a new schema blueprint.

```javascript
7:     name: { type: String, required: true },
```
*   **Attribute**: `name`
*   *   `type: String`: Must be text.
*   *   `required: true`: This field cannot be left blank when registering a user.

```javascript
8:     email: {
9:       type: String,
10:       required: true,
11:       unique: true,
12:       lowercase: true,
13:       trim: true,
```
*   **Attribute**: `email`
*   *   `unique: true`: No two users can register with the same email.
*   *   `lowercase: true`: Automatically converts emails to lowercase (e.g. `User@Kongu.edu` becomes `user@kongu.edu`).
*   *   `trim: true`: Automatically removes any accidental leading or trailing spaces.

```javascript
14:       validate: {
15:         validator: function (email) {
16:           if (email.toLowerCase() === AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
17:             return true; // designated admin email is exempt from domain restriction
18:           }
19:           if (this.role === "student") {
20:             return email.endsWith("@kongu.edu");
21:           } else {
22:             // faculty, mentor, advisor, hod, admin must end with @kongu.ac.in
23:             return email.endsWith("@kongu.ac.in");
24:           }
25:         },
```
*   **Method (Validator)**: This is a custom check function for emails.
*   *   If the email matches the designated `AUTHORIZED_ADMIN_EMAIL`, it's approved.
*   *   `if (this.role === "student")`: Checks if the user's role is a student. If yes, the email must end with `@kongu.edu`.
*   *   `else`: For staff/faculty roles (mentor, advisor, HOD), the email must end with `@kongu.ac.in`.

```javascript
26:         message: (props) =>
27:           props.value.endsWith("@kongu.edu")
28:             ? "Faculty/Staff roles must use a @kongu.ac.in email address."
29:             : "Students must use a @kongu.edu email address.",
30:       },
31:     },
```
*   **Explanation**: Custom error message returned if validation fails.

```javascript
32:     password: { type: String, required: true },
```
*   **Attribute**: `password`
*   *   Stores the hashed password (never plain-text passwords!).

```javascript
33:     role: {
34:       type: String,
35:       lowercase: true,
36:       trim: true,
37:       enum: ["student", "mentor", "advisor", "hod", "admin"],
38:       required: true,
```
*   **Attribute**: `role`
*   *   `enum`: Limits the allowed roles. The role **must** be one of these five specific values: `"student"`, `"mentor"`, `"advisor"`, `"hod"`, or `"admin"`.

```javascript
39:       validate: {
40:         validator: function (value) {
41:           if (value === "admin") {
42:             return (
43:               this.email &&
44:               this.email.toLowerCase() === AUTHORIZED_ADMIN_EMAIL.toLowerCase()
45:             );
46:           }
47:           return true;
48:         },
49:         message: "Unauthorized: Only the designated email address can have Admin access.",
50:       },
51:     },
```
*   **Method (Validator)**: Restricts who can register as an "admin". It checks if the role is `"admin"`. If so, the user's email **must** match the configured `AUTHORIZED_ADMIN_EMAIL`. Otherwise, it blocks the registration.

```javascript
52:     isApproved: {
53:       type: Boolean,
54:       default: function () {
55:         // Students & Admins auto-approved; Faculty require Admin approval
56:         return this.role === "student" || this.role === "admin";
57:       },
58:     },
```
*   **Attribute**: `isApproved`
*   *   `type: Boolean`: Can only be `true` or `false`.
*   *   `default`: Dynamically sets whether the user is approved upon registration. Students and Admins are set to `true` instantly, while staff accounts (mentors, advisors, HODs) start as `false` and need an Admin to manual approve them.

```javascript
59:     rollNumber: {
60:       type: String,
61:       required: function () {
62:         return this.role && this.role.toLowerCase() === "student";
63:       },
64:     },
```
*   **Attribute**: `rollNumber`
*   *   `required`: A conditional requirement function. It returns `true` only if the user is a `student`. Meaning students **must** supply a roll number, but faculty do not have to.

```javascript
65:     department: { type: String, required: true },
```
*   **Attribute**: `department`
*   *   Stores the department name (e.g. "CSE", "ECE"). Required for everyone.

```javascript
66:     resetToken: { type: String, default: null },
67:     resetTokenExpires: { type: Date, default: null },
```
*   **Attributes**: Used for password resets (currently disabled but kept in database blueprint).

```javascript
69:   },
70:   { timestamps: true }
71: );
```
*   **Mongoose Config**: `{ timestamps: true }` automatically adds two useful fields: `createdAt` and `updatedAt` to every user record, tracking exactly when they registered and when their details last changed.

```javascript
72: module.exports = mongoose.model("User", userSchema);
```
*   **What it does**: Compiles the blueprint into a live Mongoose Model named `"User"` and exports it.

---

## Part 4: Line-by-Line Breakdown of `utils/sendEmail.js`

This file is a utility function that sends emails to users using the **EmailJS REST API** using HTTPS requests.

```javascript
21: async function sendEmail({ to, subject, html }) {
```
*   **What it does**: Declares an asynchronous function `sendEmail`.
*   *   Takes a single object argument with three keys: `to`, `subject`, and `html`.

```javascript
22:   const serviceId = process.env.EMAILJS_SERVICE_ID;
23:   const templateId = process.env.EMAILJS_TEMPLATE_ID;
24:   const publicKey = process.env.EMAILJS_PUBLIC_KEY;
25:   const privateKey = process.env.EMAILJS_PRIVATE_KEY;
```
*   **What it does**: Extracts credentials from our secret environment variables.

```javascript
27:   if (!serviceId || !templateId || !publicKey || !privateKey) {
28:     return {
29:       sent: 0,
30:       skipped: 0,
31:       error: "EmailJS environment variables (SERVICE_ID, TEMPLATE_ID, PUBLIC_KEY, PRIVATE_KEY) are not fully set in .env."
32:     };
33:   }
```
*   **What it does**: Checks if any credentials are missing. If so, it stops immediately and returns an error message.

```javascript
35:   const allEmails = (Array.isArray(to) ? to : [to]).filter(Boolean);
36:   if (!allEmails.length) return { sent: 0, skipped: 0, error: null };
```
*   **What it does**: Converts `to` into an array and cleans it.
*   *   `Array.isArray(to) ? to : [to]`: If `to` is a single email string, it converts it to an array containing that single string. If it's already an array, it leaves it as-is.
*   *   `.filter(Boolean)`: Removes invalid items like empty strings or `null`.
*   *   `if (!allEmails.length)`: If no valid emails are left, it exits.

```javascript
38:   let sent = 0;
39:   let skipped = 0;
40:   const errors = [];
```
*   **What it does**: Sets up trackers for successful emails (`sent`), skipped emails (`skipped`), and a list of error reasons (`errors`).

```javascript
43:   for (let i = 0; i < allEmails.length; i++) {
44:     const email = allEmails[i];
```
*   **What it does**: Loops through our cleaned email list one by one.
*   *   `i` is the counter starting at `0`.
*   *   `allEmails[i]` gets the current email string.

```javascript
45:     try {
```
*   **What it does**: Starts a `try` block to handle exceptions safely.

```javascript
46:       const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
47:         method: "POST",
48:         headers: {
49:           "Content-Type": "application/json"
50:         },
51:         body: JSON.stringify({
52:           service_id: serviceId,
53:           template_id: templateId,
54:           user_id: publicKey,
55:           accessToken: privateKey,
56:           template_params: {
57:             to_email: email,
58:             subject: subject,
59:             message_html: html
60:           }
61:         })
62:       });
```
*   **What it does**: Calls the EmailJS API endpoint using `fetch`.
*   *   `fetch(URL, options)`: Built-in JavaScript function to send requests over the web.
*   *   `method: "POST"`: We are sending data.
*   *   `headers`: Informs the server we are sending JSON formatting.
*   *   `body`: Contains our secret keys and the template variables. We convert it to a string using `JSON.stringify()`.
*   *   `await`: Pauses the function until EmailJS responds.

```javascript
64:       if (!response.ok) {
65:         const text = await response.text();
66:         errors.push(`Failed for ${email}: ${text || response.statusText}`);
67:         skipped++;
68:       } else {
69:         sent++;
70:       }
```
*   **What it does**: Processes the API's response.
*   *   `response.ok`: Check if request succeeded.
*   *   `response.text()`: Reads the failure explanation from EmailJS.
*   *   `errors.push(...)`: Saves the error string.
*   *   `skipped++` or `sent++`: Increments respective counters.

```javascript
71:     } catch (err) {
72:       errors.push(`Error for ${email}: ${err.message}`);
73:       skipped++;
74:     }
```
*   **What it does**: Handles any network connection errors and keeps the loop running.

```javascript
77:     if (i < allEmails.length - 1) {
78:       await new Promise(resolve => setTimeout(resolve, 1100));
79:     }
```
*   **What it does**: Delays execution of the loop to comply with rate limits.
*   *   `allEmails.length - 1`: Only delays if there is another email after this one.
*   *   `setTimeout(resolve, 1100)`: Pauses code execution for 1.1 seconds (1100 milliseconds) so EmailJS doesn't throttle us.

```javascript
82:   return {
83:     sent,
84:     skipped,
85:     error: errors.length ? errors.slice(0, 5).join("; ") : null
86:   };
87: }
```
*   **What it does**: Returns an object representing the overall results, joining up to 5 error messages into a single text string.
