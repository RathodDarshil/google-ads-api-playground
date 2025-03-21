import { GoogleAdsApi } from "google-ads-api";
import { OAuth2Client } from "google-auth-library";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import fetch from "node-fetch";

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
 * Runs a GAQL query and displays results with performance metrics
 */
async function runGaqlQuery(gaqlQuery: string): Promise<void> {
    try {
        const client = initializeClient();
        const customer = createCustomerInstance(client);

        console.log("\nRunning query...");
        console.log(`Using customer ID: ${config.customer_id}`);

        if (config.login_customer_id) {
            console.log(`Using login customer ID: ${config.login_customer_id}`);
        }

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
 * Updates a conversion action's status from HIDDEN to ENABLED
 * @param conversionActionId The ID of the conversion action to update
 */
async function updateConversionActionStatus(conversionActionId: string): Promise<void> {
    try {
        const client = initializeClient();
        const customer = createCustomerInstance(client);

        console.log("\nUpdating conversion action status...");
        console.log(`Using customer ID: ${config.customer_id}`);

        if (config.login_customer_id) {
            console.log(`Using login customer ID: ${config.login_customer_id}`);
        }

        // Create the resource name
        const resourceName = `customers/${config.customer_id}/conversionActions/${conversionActionId}`;

        // Create the update operation
        const operation = {
            update: {
                resource_name: resourceName,
                status: "ENABLED", // Set the status to ENABLED
            },
            update_mask: {
                paths: ["status"], // Only update the status field
            },
        };

        // Call the ConversionActionService mutate method
        // Use the conversion action service properly
        const response = await customer.conversionActions.update([
            {
                resource_name: resourceName,
                status: "ENABLED",
            },
        ]);

        if (response && response.results && response.results.length > 0) {
            console.log(`\n✅ Successfully updated conversion action status to ENABLED:`);
            console.log(`Resource Name: ${response.results[0].resource_name}`);
        } else {
            console.log("\n⚠️ Update operation completed but no results returned.");
        }
    } catch (error) {
        console.error("\n❌ Error updating conversion action status:", error);
        if (error instanceof Error) {
            console.error(`Error details: ${error.message}`);
        }
    }
}

/**
 * Lists conversion actions for the current customer account
 */
async function listConversionActions(): Promise<void> {
    try {
        const client = initializeClient();
        const customer = createCustomerInstance(client);

        console.log("\nListing conversion actions...");
        console.log(`Using customer ID: ${config.customer_id}`);

        // Query to get all conversion actions with their IDs and status
        const query = `
            SELECT
                conversion_action.id,
                conversion_action.name,
                conversion_action.status,
                conversion_action.type
            FROM conversion_action
            ORDER BY conversion_action.id
        `;

        // Execute the query
        const results = await customer.query(query);

        if (results && results.length > 0) {
            console.log(`\n✅ Found ${results.length} conversion actions:`);

            // Display the results in a table format
            const formattedResults = results.map((result) => {
                // Check if conversion_action exists before accessing properties
                if (result.conversion_action) {
                    return {
                        ID: result.conversion_action.id || "N/A",
                        Name: result.conversion_action.name || "N/A",
                        Status: result.conversion_action.status || "N/A",
                        Type: result.conversion_action.type || "N/A",
                    };
                }
                return {
                    ID: "N/A",
                    Name: "N/A",
                    Status: "N/A",
                    Type: "N/A",
                };
            });

            console.table(formattedResults);

            return;
        } else {
            console.log("\n⚠️ No conversion actions found.");
        }
    } catch (error) {
        console.error("\n❌ Error listing conversion actions:", error);
    }
}

/**
 * Creates a Third-Party App Analytics Link
 * @param appAnalyticsProviderId The ID of the app analytics provider
 */
async function createThirdPartyAppAnalyticsLink(appAnalyticsProviderId: number = 8650286658): Promise<void> {
    try {
        const oauth2Client = new OAuth2Client(config.client_id, config.client_secret, "http://localhost:8080");

        console.log("\nCreating Third-Party App Analytics Link...");
        console.log(`Using customer ID: ${config.customer_id}`);

        if (config.login_customer_id) {
            console.log(`Using login customer ID: ${config.login_customer_id}`);
        }

        // Set token with refresh token
        oauth2Client.setCredentials({
            refresh_token: config.refresh_token,
        });

        // Get access token
        const tokenResponse = await oauth2Client.getAccessToken();
        const accessToken = tokenResponse.token;

        if (!accessToken) {
            throw new Error("Failed to obtain access token");
        }

        // Prepare headers for the request
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "developer-token": config.developer_token,
            Authorization: `Bearer ${accessToken}`,
        };

        // Add login-customer-id if it exists
        if (config.login_customer_id) {
            headers["login-customer-id"] = config.login_customer_id;
        }

        // Prepare the request body
        const requestBody = {
            customer_id: config.customer_id,
            operations: [
                {
                    create: {
                        identifier: {
                            app_analytics_provider_id: appAnalyticsProviderId,
                        },
                    },
                },
            ],
        };

        // API endpoint URL
        const url = `https://googleads.google.com/v19/customers/${config.customer_id}/thirdpartyappanalyticslinks:mutate`;

        // Make the API call using fetch
        const response = await fetch(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }

        const responseData = await response.json();

        if (responseData && responseData.results && responseData.results.length > 0) {
            console.log(`\n✅ Successfully created Third-Party App Analytics Link:`);
            console.log(JSON.stringify(responseData.results[0], null, 2));
        } else {
            console.log("\n⚠️ Operation completed but no results returned.");
            console.log(JSON.stringify(responseData, null, 2));
        }
    } catch (error) {
        console.error("\n❌ Error creating Third-Party App Analytics Link:", error);
        if (error instanceof Error) {
            console.error(`Error details: ${error.message}`);
        }
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

    // Main menu loop
    let exitProgram = false;

    while (!exitProgram) {
        console.log("\n========================================");
        console.log("Main Menu");
        console.log("========================================");
        console.log("1. List accessible customer accounts");
        console.log("2. Run GAQL query");
        console.log("3. List conversion actions");
        console.log("4. Update conversion action status (HIDDEN → ENABLED)");
        console.log("5. Create Third-Party App Analytics Link");
        console.log("6. Exit");

        const choice = await new Promise<string>((resolve) => {
            rl.question("\nSelect an option (1-6): ", (answer) => {
                resolve(answer);
            });
        });

        switch (choice) {
            case "1":
                await listAccessibleCustomers();
                break;
            case "2":
                // Prompt for GAQL query
                const gaqlQuery = await new Promise<string>((resolve) => {
                    console.log("\nEnter your GAQL query:");
                    console.log("Example: SELECT campaign.id, campaign.name, metrics.impressions FROM campaign");
                    rl.question("> ", (answer) => {
                        resolve(answer);
                    });
                });
                await runGaqlQuery(gaqlQuery);
                break;
            case "3":
                await listConversionActions();
                break;
            case "4":
                // First list conversion actions to help the user select one
                await listConversionActions();

                // Prompt for conversion action ID
                const conversionActionId = await new Promise<string>((resolve) => {
                    rl.question(
                        "\nEnter the ID of the conversion action to update from HIDDEN to ENABLED: ",
                        (answer) => {
                            resolve(answer);
                        }
                    );
                });

                if (conversionActionId) {
                    await updateConversionActionStatus(conversionActionId);
                } else {
                    console.log("\n⚠️ No conversion action ID provided. Operation cancelled.");
                }
                break;
            case "5":
                // Prompt for app analytics provider ID (optional)
                const useDefaultProviderId = await new Promise<string>((resolve) => {
                    rl.question("\nUse default App Analytics Provider ID (8650286658)? (yes/no): ", (answer) => {
                        resolve(answer.toLowerCase());
                    });
                });

                if (useDefaultProviderId === "yes" || useDefaultProviderId === "y") {
                    await createThirdPartyAppAnalyticsLink();
                } else {
                    const providerId = await new Promise<string>((resolve) => {
                        rl.question("\nEnter the App Analytics Provider ID: ", (answer) => {
                            resolve(answer);
                        });
                    });

                    if (providerId) {
                        await createThirdPartyAppAnalyticsLink(Number(providerId));
                    } else {
                        console.log("\n⚠️ No provider ID provided. Using default (8650286658).");
                        await createThirdPartyAppAnalyticsLink();
                    }
                }
                break;
            case "6":
                exitProgram = true;
                console.log("\nThank you for using Google Ads API Query Tool!");
                break;
            default:
                console.log("\n⚠️ Invalid option. Please select a number between 1 and 6.");
        }
    }

    rl.close();
}

// Run the tool
main()
    .catch(console.error)
    .finally(() => {
        rl.close();
        process.exit(0);
    });
