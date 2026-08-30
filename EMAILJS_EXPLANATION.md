# EmailJS Integration Explanation (Line-by-Line)

This document provides a complete, beginner-friendly explanation of how the email integration works in the SAP Portal backend.

---

## 1. File: `utils/sendEmail.js`

This utility file handles the actual connection to the EmailJS API and manages sending the emails to your users.

```javascript
/**
 * utils/sendEmail.js
 *
 * Sends emails via EmailJS REST API (HTTPS — works on Render free tier).
 *
 * Set these environment variables:
 *   EMAILJS_SERVICE_ID  = your EmailJS service ID (e.g. service_xxxxxxx)
 *   EMAILJS_TEMPLATE_ID = your EmailJS template ID (e.g. template_xxxxxxx)
 *   EMAILJS_PUBLIC_KEY  = your EmailJS public key (from Account settings)
 *   EMAILJS_PRIVATE_KEY = your EmailJS REST API key / access token (from Account settings)
 */

/**
 * Send one email to one or many recipients.
 * @param {object} opts
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @returns {{ sent: number, skipped: number, error: string|null }}
 */
async function sendEmail({ to, subject, html }) {
```
* **`async function sendEmail(...)`**: Declares an asynchronous function named `sendEmail`. An asynchronous function allows us to pause execution using `await` while waiting for external events (like web requests) to complete, without freezing the entire application.
* **`{ to, subject, html }`**: These are input parameters:
  * `to`: Can be a single email address string (e.g. `"test@test.com"`) or a list/array of emails.
  * `subject`: The subject line of the email.
  * `html`: The message content formatted in rich HTML.

---

```javascript
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;
```
* **`const`**: Declares variables that cannot be reassigned.
* **`process.env`**: This is a built-in Node.js object containing environment variables. Instead of hardcoding your private API credentials in the code, they are securely loaded from the `.env` file (or Render dashboard).

---

```javascript
  if (!serviceId || !templateId || !publicKey || !privateKey) {
    return {
      sent: 0,
      skipped: 0,
      error: "EmailJS environment variables (SERVICE_ID, TEMPLATE_ID, PUBLIC_KEY, PRIVATE_KEY) are not fully set in .env."
    };
  }
```
* **`if` statement**: Checks if any of the required keys are missing (the `!` symbol means NOT, and `||` means OR).
* **`return`**: Instantly exits the function and returns an error response if the credentials are not configured.

---

```javascript
  const allEmails = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!allEmails.length) return { sent: 0, skipped: 0, error: null };
```
* **`Array.isArray(to)`**: Checks if the `to` parameter is already a list (array).
* **`? to : [to]`**: If it is an array, it uses it. If it is a single string, it wraps it inside square brackets `[to]` to turn it into an array.
* **`.filter(Boolean)`**: Filters out empty or invalid email values (like `null` or `undefined`).
* **`if (!allEmails.length)`**: Stops the function if there are no valid email addresses in the list.

---

```javascript
  let sent = 0;
  let skipped = 0;
  const errors = [];
```
* **`let`**: Declares variables that can be modified as the code runs.
* `sent`: Tracks successful email dispatches.
* `skipped`: Tracks failed email dispatches.
* `errors`: An array where we will collect any error messages.

---

```javascript
  // Send sequentially with 1.1s delay between each to stay under EmailJS's 1 req/sec limit
  for (let i = 0; i < allEmails.length; i++) {
    const email = allEmails[i];
```
* **`for` loop**: Loops through the list of email addresses one by one.
* `i = 0`: Starts the loop counter at index `0`.
* `i < allEmails.length`: Continues looping as long as `i` is less than the total count of emails.
* `i++`: Increments `i` by 1 after each cycle.
* `allEmails[i]`: Retrieves the email address at the current index.

---

```javascript
    try {
      const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          accessToken: privateKey,
          template_params: {
            to_email: email,
            subject: subject,
            message_html: html
          }
        })
      });
```
* **`try`**: Wraps the code in a trial block. If anything goes wrong, it jumps to the `catch` block instead of crashing the server.
* **`await fetch(...)`**: Performs a standard HTTPS request to the EmailJS server and pauses the loop until the request completes.
* **`method: "POST"`**: Tells the API we are sending/creating data.
* **`headers`**: Specifies that we are sending JSON data.
* **`body: JSON.stringify(...)`**: Converts our JavaScript payload object into a JSON string format that the EmailJS REST API requires.
  * `template_params`: Sends variables (`to_email`, `subject`, `message_html`) which are injected into your EmailJS dashboard template.

---

```javascript
      if (!response.ok) {
        const text = await response.text();
        errors.push(`Failed for ${email}: ${text || response.statusText}`);
        skipped++;
      } else {
        sent++;
      }
```
* **`response.ok`**: Returns `true` if the HTTP status code is in the 200-299 range (success).
* If it failed (`!response.ok`), we read the error response (`response.text()`), record the error in our log (`errors.push`), and increase the `skipped` counter.
* If it succeeded, we increase the `sent` counter.

---

```javascript
    } catch (err) {
      errors.push(`Error for ${email}: ${err.message}`);
      skipped++;
    }
```
* **`catch (err)`**: Captures network-level failures (like connection drops) and safely logs them.

---

```javascript
    // Add a 1100ms delay before the next email (except for the last one)
    if (i < allEmails.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
  }
```
* **Rate-Limit Safeguard**: EmailJS enforces a limit of **1 request per second**.
* **`setTimeout(resolve, 1100)`**: Pauses the loop execution for 1.1 seconds before continuing to the next iteration. This ensures the EmailJS server never rate-limits our requests.

---

```javascript
  return {
    sent,
    skipped,
    error: errors.length ? errors.slice(0, 5).join("; ") : null
  };
}

module.exports = { sendEmail };
```
* **`return`**: Returns the final report object with counters and error details.
* **`module.exports`**: Exports the `sendEmail` function so it can be imported and executed by other files.

---

## 2. File: `routes/sapStructureRoutes.js` (Asynchronous Call)

To prevent the browser request from timing out while we process emails sequentially (which takes around 68 seconds), we run the `notifyAllUsers()` function asynchronously in the background.

```javascript
    const userCount = await User.countDocuments({});

    // Trigger email sending in the background (Notice the missing 'await')
    notifyAllUsers()
      .then((result) => console.log(`[sap/publish] Background emails sent: ${result.sent}`))
      .catch((err) => console.error("[sap/publish] Background email notification failed:", err.message));

    res.json({
      message: "SAP structure published successfully. Email notifications are being sent to all users in the background.",
      notifiedCount: userCount,
      emailSkipped: 0,
      emailError: null,
    });
```

* **Missing `await`**: We do NOT put `await` in front of `notifyAllUsers()`. This allows the server to skip waiting and execute the code below immediately.
* **`res.json(...)`**: Immediately responds to the admin dashboard UI within milliseconds, so the web page does not hang or timeout.
* **`.then(...)` and `.catch(...)`**: Tells Node.js to wait for the background email process to finish in its own time. When it finishes, it will print the results (or errors) directly to the server log console.
