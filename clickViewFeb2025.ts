import { GoogleAdsApi } from "google-ads-api";
import { OAuth2Client } from "google-auth-library";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

/**
 * Click View Data Collector - Last 90 Days
 *
 * This script collects click_view data for the last 90 days
 * using the Google Ads API.
 */

// Load environment variables
dotenv.config();

// Types for configuration
interface GoogleAdsConfig {
    developer_token: string;
    client_id: string;
    client_secret: string;
    refresh_token?: string;
    customer_id?: string;
    login_customer_id?: string;
}

// Default configuration (will be loaded from .env or user input)
const config: GoogleAdsConfig = {
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
    client_id: process.env.GOOGLE_ADS_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || "",
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || "",
    customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID || "",
    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "",
};

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

/**
 * Prompts the user for missing configuration values
 */
async function promptForMissingConfig(): Promise<void> {
    const requiredFields: (keyof GoogleAdsConfig)[] = ["developer_token", "client_id", "client_secret"];

    for (const field of requiredFields) {
        if (!config[field]) {
            config[field] = await new Promise((resolve) => {
                rl.question(`Please enter your ${field.replace(/_/g, " ")}: `, (answer) => {
                    resolve(answer);
                });
            });
        }
    }

    // For refresh token, we'll check if it exists; if not, we'll guide through obtaining one
    if (!config.refresh_token) {
        console.log("\nYou need to obtain a refresh token for Google Ads API authentication.");
        console.log("Would you like to generate an authorization URL to get a refresh token? (yes/no)");

        const answer = await new Promise<string>((resolve) => {
            rl.question("> ", (answer) => {
                resolve(answer.toLowerCase());
            });
        });

        if (answer === "yes" || answer === "y") {
            await generateAuthUrl();
        } else {
            config.refresh_token = await new Promise((resolve) => {
                rl.question("Please enter your refresh token manually: ", (answer) => {
                    resolve(answer);
                });
            });
        }
    }

    // Ask for customer ID if not provided
    if (!config.customer_id) {
        config.customer_id = await new Promise((resolve) => {
            rl.question("Please enter the customer ID you want to query (without dashes): ", (answer) => {
                resolve(answer);
            });
        });
    }

    // Ask for login customer ID (optional)
    if (!config.login_customer_id) {
        const useLoginId = await new Promise<string>((resolve) => {
            rl.question("Do you want to specify a login customer ID? (yes/no): ", (answer) => {
                resolve(answer.toLowerCase());
            });
        });

        if (useLoginId === "yes" || useLoginId === "y") {
            config.login_customer_id = await new Promise((resolve) => {
                rl.question("Please enter the login customer ID: ", (answer) => {
                    resolve(answer);
                });
            });
        }
    }

    // Save config to .env file
    const envContent = Object.entries(config)
        .map(([key, value]) => `GOOGLE_ADS_${key.toUpperCase()}=${value}`)
        .join("\n");

    fs.writeFileSync(path.join(process.cwd(), ".env"), envContent);
    console.log("\nConfiguration saved to .env file.");
}

/**
 * Generates an authorization URL for obtaining a refresh token
 */
async function generateAuthUrl(): Promise<void> {
    // Create local server to capture the auth code
    const server = require("http").createServer();
    const port = 8080; // Use the same port you defined in Google Cloud Console
    let resolveAuthCodePromise: (value: string) => void;
    let authCodePromise = new Promise<string>((resolve) => {
        resolveAuthCodePromise = resolve;
    });

    // Setup server to capture the authorization code from the redirect
    server.on("request", (req: any, res: any) => {
        const url = new URL(req.url, `http://localhost:${port}`);
        const code = url.searchParams.get("code");

        if (code) {
            // Return a success page to the user
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
                <html>
                    <body>
                        <h1>Authentication Successful</h1>
                        <p>You have successfully authenticated with Google Ads API.</p>
                        <p>You can close this window and return to the application.</p>
                    </body>
                </html>
            `);

            // Resolve the promise with the authorization code
            resolveAuthCodePromise(code);

            // Close the server after a short delay
            setTimeout(() => {
                server.close();
            }, 1000);
        } else {
            // Handle error case
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`
                <html>
                    <body>
                        <h1>Authentication Failed</h1>
                        <p>No authorization code was received.</p>
                        <p>Please try again.</p>
                    </body>
                </html>
            `);
        }
    });

    // Start the server
    server.listen(port, () => {
        console.log(`Local authentication server started on port ${port}`);
    });

    const oauth2Client = new OAuth2Client(
        config.client_id,
        config.client_secret,
        `http://localhost:${port}` // Use localhost redirect instead of OOB
    );

    const scopes = ["https://www.googleapis.com/auth/adwords"];

    const authorizeUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: "consent",
    });

    console.log("\n==================== AUTHORIZATION INSTRUCTIONS ====================");
    console.log("\n1. Open this URL in your browser:");
    console.log("\x1b[1m\x1b[34m" + authorizeUrl + "\x1b[0m");
    console.log("\n2. Sign in with your Google account");
    console.log("3. Grant permissions requested by the application");
    console.log("4. You will be redirected to localhost where the code will be automatically captured");
    console.log("\n=====================================================================");

    try {
        // Wait for the authorization code from the server
        console.log("\nWaiting for authentication in browser...");
        const authCode = await authCodePromise;

        console.log("\nAuthorization code received! Exchanging for refresh token...");
        const { tokens } = await oauth2Client.getToken(authCode);

        if (tokens.refresh_token) {
            config.refresh_token = tokens.refresh_token;
            console.log("\n✅ Successfully obtained refresh token!");
        } else {
            console.error('\n❌ No refresh token returned. Please ensure you set prompt: "consent" and try again.');

            // Ask if user wants to try again
            const retry = await new Promise<string>((resolve) => {
                rl.question("Would you like to try again? (yes/no): ", (answer) => {
                    resolve(answer.toLowerCase());
                });
            });

            if (retry === "yes" || retry === "y") {
                return await generateAuthUrl();
            }
        }
    } catch (error) {
        console.error("\n❌ Error during authentication:", error);

        // Ask if user wants to try again
        const retry = await new Promise<string>((resolve) => {
            rl.question("Would you like to try again? (yes/no): ", (answer) => {
                resolve(answer.toLowerCase());
            });
        });

        if (retry === "yes" || retry === "y") {
            return await generateAuthUrl();
        }
    }
}

/**
 * Initializes the Google Ads API client
 */
function initializeClient(): GoogleAdsApi {
    return new GoogleAdsApi({
        client_id: config.client_id,
        client_secret: config.client_secret,
        developer_token: config.developer_token,
    });
}

/**
 * Creates a customer instance based on configuration
 */
function createCustomerInstance(client: GoogleAdsApi) {
    const customerConfig: any = {
        customer_id: config.customer_id!,
        refresh_token: config.refresh_token!,
    };

    // Add optional parameters if they exist
    if (config.login_customer_id) {
        customerConfig.login_customer_id = config.login_customer_id;
    }

    return client.Customer(customerConfig);
}

/**
 * Runs a GAQL query for click_view data for a specific date
 */
async function runClickViewQuery(dateStr: string): Promise<any[]> {
    try {
        const client = initializeClient();
        const customer = createCustomerInstance(client);

        console.log(`Running query for date: ${dateStr}...`);

        // The GAQL query with the date parameter
        const gaqlQuery = `
            SELECT 
                click_view.gclid, 
                click_view.page_number, 
                click_view.ad_group_ad, 
                click_view.keyword,
                click_view.area_of_interest.city,
                campaign.id, 
                campaign.name, 
                ad_group.id, 
                ad_group.name, 
                segments.date, 
                segments.device, 
                segments.ad_network_type,
                segments.click_type,
                metrics.clicks
            FROM click_view 
            WHERE segments.date = '${dateStr}'
        `;

        // Execute the query
        const results = await customer.query(gaqlQuery);

        console.log(`✅ Query returned ${results.length} results for ${dateStr}`);
        return results;
    } catch (error) {
        console.error(`❌ Error running GAQL query for ${dateStr}:`, error);
        return [];
    }
}

/**
 * Generates an array of date strings for the last 90 days (including today)
 */
function generateLast90DaysDates(): string[] {
    const dates: string[] = [];
    const today = new Date();

    for (let i = 0; i < 90; i++) {
        const date = new Date();
        date.setDate(today.getDate() - i);

        // Format: YYYY-MM-DD
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");

        dates.push(`${year}-${month}-${day}`);
    }

    return dates;
}

/**
 * Saves results to a JSON file
 */
function saveResultsToFile(date: string, results: any[]): void {
    if (results.length === 0) return;

    const outputDir = path.join(process.cwd(), "click_view_data");

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const fileName = `click_view_${date}.json`;
    const filePath = path.join(outputDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
    console.log(`✅ Saved ${results.length} results to ${filePath}`);
}

/**
 * Lists accessible customers for the authenticated user
 */
async function listAccessibleCustomers(): Promise<void> {
    try {
        const client = initializeClient();
        console.log("\nListing accessible customer accounts...");

        const response = await client.listAccessibleCustomers(config.refresh_token!);

        // The response is expected to have a 'resource_names' array
        if (response && response.resource_names && response.resource_names.length > 0) {
            console.log(`\n✅ Found ${response.resource_names.length} accessible customer accounts:`);
            response.resource_names.forEach((resourceName: string, index: number) => {
                // Extract customer ID from resource name (format: customers/1234567890)
                const customerId = resourceName.split("/")[1];
                console.log(`${index + 1}. Customer ID: ${customerId}`);
            });
        } else {
            console.log("\n⚠️ No accessible customer accounts found.");
        }
    } catch (error) {
        console.error("\n❌ Error listing accessible customers:", error);
    }
}

/**
 * Main function to run the data collection
 */
async function main(): Promise<void> {
    console.log("========================================");
    console.log("Google Ads Click View Data Collector");
    console.log("Last 90 Days");
    console.log("========================================");

    // Check if config needs to be set up
    await promptForMissingConfig();

    console.log("\n✅ Authentication completed successfully!");

    // Ask if user wants to list accessible customers
    const listCustomers = await new Promise<string>((resolve) => {
        rl.question("\nDo you want to list all accessible customer accounts? (yes/no): ", (answer) => {
            resolve(answer.toLowerCase());
        });
    });

    if (listCustomers === "yes" || listCustomers === "y") {
        await listAccessibleCustomers();
    }

    // Generate dates for the last 90 days
    const last90DaysDates = generateLast90DaysDates();
    console.log(`\nPreparing to collect data for the last ${last90DaysDates.length} days`);

    // Collect data for each day
    let totalResults = 0;

    for (const date of last90DaysDates) {
        const results = await runClickViewQuery(date);
        totalResults += results.length;

        // Save results to file if there are any
        saveResultsToFile(date, results);

        // Add a small delay between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log("\n========================================");
    console.log(`Data collection complete!`);
    console.log(`Total records collected: ${totalResults}`);
    console.log(`Data saved to: ${path.join(process.cwd(), "click_view_data")}`);
    console.log("========================================");

    rl.close();
}

// Run the data collector
main()
    .catch(console.error)
    .finally(() => {
        rl.close();
        process.exit(0);
    });
