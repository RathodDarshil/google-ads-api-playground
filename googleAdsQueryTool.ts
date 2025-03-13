import { GoogleAdsApi } from "google-ads-api";
import { OAuth2Client } from "google-auth-library";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

/**
 * Google Ads API Query Tool
 *
 * This tool provides a simplified interface for authenticating with the Google Ads API
 * and running GAQL queries with performance metrics.
 */

// Load environment variables
dotenv.config();

// Types for configuration
interface GoogleAdsConfig {
    developer_token: string;
    client_id: string;
    client_secret: string;
    refresh_token?: string;
    login_customer_id?: string;
    linked_customer_id?: string;
}

// Default configuration (will be loaded from .env or user input)
const config: GoogleAdsConfig = {
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
    client_id: process.env.GOOGLE_ADS_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || "",
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || "",
    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "",
    linked_customer_id: process.env.GOOGLE_ADS_LINKED_CUSTOMER_ID || "",
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
    const requiredFields: (keyof GoogleAdsConfig)[] = [
        "developer_token",
        "client_id",
        "client_secret",
        "login_customer_id",
    ];

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

    // Ask for linked customer ID if not provided
    if (!config.linked_customer_id) {
        config.linked_customer_id = await new Promise((resolve) => {
            rl.question("Please enter the customer ID you want to query (without dashes): ", (answer) => {
                resolve(answer);
            });
        });
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
 * with improved handling for authorization code extraction
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
 * Runs a GAQL query and displays results with performance metrics
 */
async function runGaqlQuery(gaqlQuery: string): Promise<void> {
    try {
        const client = initializeClient();
        const customer = client.Customer({
            customer_id: config.login_customer_id!,
            refresh_token: config.refresh_token!,
            login_customer_id: config.login_customer_id,
        });

        console.log("\nRunning query...");

        // Execute the query
        const results = await customer.query(gaqlQuery);

        if (results && results.length > 0) {
            console.log(`\n✅ Query returned ${results.length} results:`);

            // Format and display the results
            // Convert micros values to dollars where relevant
            const formattedResults = results.map((result) => {
                // Create a new object to avoid modifying the original
                const formatted = { ...result };

                // Format metrics if present
                if (formatted.metrics) {
                    // Handle cost_micros conversion
                    if (formatted.metrics.cost_micros) {
                        (formatted.metrics as any).cost =
                            `$${(parseInt(String(formatted.metrics.cost_micros)) / 1000000).toFixed(2)}`;
                    }

                    // Handle ctr as percentage
                    if (formatted.metrics.ctr) {
                        (formatted.metrics as any).ctr_percent =
                            `${(parseFloat(String(formatted.metrics.ctr)) * 100).toFixed(2)}%`;
                    }

                    // Handle average_cpc conversion
                    if (formatted.metrics.average_cpc) {
                        (formatted.metrics as any).average_cpc_dollars =
                            `$${(parseInt(String(formatted.metrics.average_cpc)) / 1000000).toFixed(2)}`;
                    }
                }

                return formatted;
            });

            // Display the results
            console.table(formattedResults);

            // Also provide the raw JSON for reference
            console.log("\nRaw results (for reference):");
            console.log(JSON.stringify(results, null, 2));
        } else {
            console.log("\n⚠️ Query returned no results.");
        }
    } catch (error) {
        console.error("\n❌ Error running GAQL query:", error);
    }
}

/**
 * Main function to run the tool
 */
async function main(): Promise<void> {
    console.log("========================================");
    console.log("Google Ads API Query Tool");
    console.log("========================================");

    // Check if config needs to be set up
    await promptForMissingConfig();

    console.log("\n✅ Authentication completed successfully!");

    // Continuous query loop
    let continueQuerying = true;

    while (continueQuerying) {
        // Prompt for GAQL query
        const gaqlQuery = await new Promise<string>((resolve) => {
            console.log("\nEnter your GAQL query:");
            console.log("Example: SELECT campaign.id, campaign.name, metrics.impressions FROM campaign");
            rl.question("> ", (answer) => {
                resolve(answer);
            });
        });

        // Run the query
        await runGaqlQuery(gaqlQuery);

        // Ask if user wants to run another query
        const runAnother = await new Promise<string>((resolve) => {
            rl.question("\nDo you want to run another query? (yes/no): ", (answer) => {
                resolve(answer.toLowerCase());
            });
        });

        continueQuerying = runAnother === "yes" || runAnother === "y";
    }

    console.log("\nThank you for using Google Ads API Query Tool!");
    rl.close();
}

// Run the tool
main()
    .catch(console.error)
    .finally(() => {
        rl.close();
        process.exit(0);
    });
