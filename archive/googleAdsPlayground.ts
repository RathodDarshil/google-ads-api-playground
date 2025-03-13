import { GoogleAdsApi } from "google-ads-api";
import { OAuth2Client } from "google-auth-library";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

/**
 * Google Ads API Testing Playground
 *
 * This file contains all the necessary code to test the Google Ads API.
 * It handles authentication, API calls, and provides sample queries.
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

// Log the initial configuration
console.log("Initial configuration:");
console.log(JSON.stringify(config, null, 2));

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
 */
async function generateAuthUrl(): Promise<void> {
    const oauth2Client = new OAuth2Client(config.client_id, config.client_secret, "urn:ietf:wg:oauth:2.0:oob");

    const scopes = ["https://www.googleapis.com/auth/adwords"];

    const authorizeUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: "consent",
    });

    console.log("\n1. Open this URL in your browser:");
    console.log(authorizeUrl);
    console.log("\n2. Authorize the application");
    console.log("3. Copy the authorization code");

    const authCode = await new Promise<string>((resolve) => {
        rl.question("\nEnter the authorization code: ", (code) => {
            resolve(code);
        });
    });

    try {
        const { tokens } = await oauth2Client.getToken(authCode);
        if (tokens.refresh_token) {
            config.refresh_token = tokens.refresh_token;
            console.log("Successfully obtained refresh token!");
        } else {
            console.error('No refresh token returned. Please ensure you set prompt: "consent" and try again.');
        }
    } catch (error) {
        console.error("Error exchanging authorization code for tokens:", error);
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
 * Runs a sample query to test the API connection
 */
async function runTestQuery(): Promise<void> {
    try {
        const client = initializeClient();

        // List all accessible customer accounts
        console.log("\nListing all accessible customer accounts...");
        try {
            const accessibleCustomers = await client.listAccessibleCustomers(config.refresh_token!);
            console.log("\nAccessible Customer Accounts:");
            accessibleCustomers.resource_names.forEach((resourceName, index) => {
                // Extract customer ID from resource name (format: "customers/1234567890")
                const customerId = resourceName.split("/")[1];
                console.log(`${index + 1}. Customer ID: ${customerId} (${resourceName})`);
            });
            console.log(`\nTotal accessible accounts: ${accessibleCustomers.resource_names.length}`);
        } catch (error) {
            console.error("Error listing accessible customers:", error);
        }

        const customer = client.Customer({
            customer_id: config.login_customer_id!,
            refresh_token: config.refresh_token!,
            login_customer_id: config.linked_customer_id,
            // linked_customer_id: config.linked_customer_id,
        });

        // Check if the customer is accessible
        try {
            // Test accessibility by making a simple request
            await customer.query("SELECT customer.id FROM customer LIMIT 1");
            console.log("\nCustomer account is accessible.");
        } catch (error) {
            console.error("\nCustomer account is not accessible:", error);
            console.log("Please check your credentials and customer IDs.");
            return; // Exit the function if customer is not accessible
        }

        const click_view = await customer.query(`
            SELECT
            *
                FROM
                events
                WHERE
                eventName = 'first_open'
                 `);

        console.log("click_view", click_view);

        // Sample query to get campaigns
        const campaigns = await customer.report({
            entity: "campaign",
            attributes: [
                "campaign.id",
                "campaign.name",
                "campaign.status",
                "campaign.advertising_channel_type",
                "campaign.start_date",
                "campaign.end_date",
            ],
            metrics: ["metrics.impressions", "metrics.clicks", "metrics.cost_micros", "metrics.conversions"],
            limit: 10,
        });

        console.log("\nSUCCESS! Retrieved campaigns:");
        console.table(
            campaigns.map((c) => ({
                id: c.campaign?.id,
                name: c.campaign?.name,
                status: c.campaign?.status,
                channel: c.campaign?.advertising_channel_type,
                impressions: c.metrics?.impressions,
                clicks: c.metrics?.clicks,
                cost: c.metrics?.cost_micros ? (parseInt(String(c.metrics.cost_micros)) / 1000000).toFixed(2) : "0.00",
                conversions: c.metrics?.conversions,
            }))
        );
    } catch (error) {
        console.error("Error running test query:", error);
    }
}

/**
 * Displays a menu of example queries to run
 */
async function showExampleQueriesMenu(): Promise<void> {
    console.log("\nAvailable Example Queries:");
    console.log("1. List Campaigns");
    console.log("2. List Ad Groups");
    console.log("3. List Keywords");
    console.log("4. List Ads");
    console.log("5. Get Account Performance");
    console.log("6. Get Campaign Performance");
    console.log("7. Run Custom GAQL Query");
    console.log("8. Exit");

    const choice = await new Promise<string>((resolve) => {
        rl.question("\nSelect an option (1-8): ", (answer) => {
            resolve(answer);
        });
    });

    switch (choice) {
        case "1":
            await runCampaignsQuery();
            break;
        case "2":
            await runAdGroupsQuery();
            break;
        case "3":
            await runKeywordsQuery();
            break;
        case "4":
            await runAdsQuery();
            break;
        case "5":
            await runAccountPerformanceQuery();
            break;
        case "6":
            await runCampaignPerformanceQuery();
            break;
        case "7":
            await runCustomQuery();
            break;
        case "8":
            return;
        default:
            console.log("Invalid option. Please try again.");
            await showExampleQueriesMenu();
    }

    // After running a query, show the menu again
    await showExampleQueriesMenu();
}

/**
 * Run a query to list campaigns
 */
async function runCampaignsQuery(): Promise<void> {
    try {
        const client = initializeClient();
        const customer = client.Customer({
            customer_id: config.login_customer_id!,
            refresh_token: config.refresh_token!,
            login_customer_id: config.login_customer_id,
            linked_customer_id: config.linked_customer_id,
        });

        const campaigns = await customer.report({
            entity: "campaign",
            attributes: [
                "campaign.id",
                "campaign.name",
                "campaign.status",
                "campaign.advertising_channel_type",
                "campaign.start_date",
            ],
            metrics: ["metrics.impressions", "metrics.clicks", "metrics.cost_micros"],
            limit: 20,
        });

        console.log("\nCampaigns:");
        console.table(
            campaigns.map((c) => ({
                id: c.campaign?.id,
                name: c.campaign?.name,
                status: c.campaign?.status,
                channel: c.campaign?.advertising_channel_type,
                impressions: c.metrics?.impressions,
                clicks: c.metrics?.clicks,
                cost: c.metrics?.cost_micros ? (parseInt(String(c.metrics.cost_micros)) / 1000000).toFixed(2) : "0.00",
            }))
        );
    } catch (error) {
        console.error("Error running campaigns query:", error);
    }
}

/**
 * Run a query to list ad groups
 */
async function runAdGroupsQuery(): Promise<void> {
    try {
        const client = initializeClient();
        const customer = client.Customer({
            customer_id: config.login_customer_id!,
            refresh_token: config.refresh_token!,
            login_customer_id: config.login_customer_id,
            linked_customer_id: config.linked_customer_id,
        });

        const adGroups = await customer.report({
            entity: "ad_group",
            attributes: ["ad_group.id", "ad_group.name", "ad_group.status", "campaign.name"],
            metrics: ["metrics.impressions", "metrics.clicks", "metrics.cost_micros"],
            limit: 20,
        });

        customer.query(`
            `);

        console.log("\nAd Groups:");
        console.table(
            adGroups.map((ag) => ({
                id: ag.ad_group?.id,
                name: ag.ad_group?.name,
                status: ag.ad_group?.status,
                campaign: ag.campaign?.name,
                impressions: ag.metrics?.impressions,
                clicks: ag.metrics?.clicks,
                cost: ag.metrics?.cost_micros
                    ? (parseInt(String(ag.metrics.cost_micros)) / 1000000).toFixed(2)
                    : "0.00",
            }))
        );
    } catch (error) {
        console.error("Error running ad groups query:", error);
    }
}

/**
 * Run a query to list keywords
 */
async function runKeywordsQuery(): Promise<void> {
    try {
        const client = initializeClient();
        const customer = client.Customer({
            customer_id: config.login_customer_id!,
            refresh_token: config.refresh_token!,
            login_customer_id: config.login_customer_id,
            linked_customer_id: config.linked_customer_id,
        });

        const keywords = await customer.report({
            entity: "ad_group_criterion",
            attributes: [
                "ad_group_criterion.criterion_id",
                "ad_group_criterion.keyword.text",
                "ad_group_criterion.keyword.match_type",
                "ad_group_criterion.status",
                "ad_group.name",
                "campaign.name",
            ],
            constraints: [
                {
                    key: "ad_group_criterion.type",
                    op: "=",
                    val: "KEYWORD",
                },
            ],
            metrics: ["metrics.impressions", "metrics.clicks", "metrics.cost_micros"],
            limit: 20,
        });

        console.log("\nKeywords:");
        console.table(
            keywords.map((k) => ({
                id: k.ad_group_criterion?.criterion_id,
                keyword: k.ad_group_criterion?.keyword?.text,
                matchType: k.ad_group_criterion?.keyword?.match_type,
                status: k.ad_group_criterion?.status,
                adGroup: k.ad_group?.name,
                campaign: k.campaign?.name,
                impressions: k.metrics?.impressions,
                clicks: k.metrics?.clicks,
                cost: k.metrics?.cost_micros ? (parseInt(String(k.metrics.cost_micros)) / 1000000).toFixed(2) : "0.00",
            }))
        );
    } catch (error) {
        console.error("Error running keywords query:", error);
    }
}

/**
 * Run a query to list ads
 */
async function runAdsQuery(): Promise<void> {
    try {
        const client = initializeClient();
        const customer = client.Customer({
            customer_id: config.login_customer_id!,
            refresh_token: config.refresh_token!,
            login_customer_id: config.login_customer_id,
            linked_customer_id: config.linked_customer_id,
        });

        const ads = await customer.report({
            entity: "ad_group_ad",
            attributes: [
                "ad_group_ad.ad.id",
                "ad_group_ad.ad.final_urls",
                "ad_group_ad.status",
                "ad_group_ad.ad.type",
                "ad_group.name",
                "campaign.name",
            ],
            metrics: ["metrics.impressions", "metrics.clicks", "metrics.cost_micros"],
            limit: 20,
        });

        console.log("\nAds:");
        console.table(
            ads.map((a) => ({
                id: a.ad_group_ad?.ad?.id,
                type: a.ad_group_ad?.ad?.type,
                finalUrl: a.ad_group_ad?.ad?.final_urls?.[0] || "N/A",
                status: a.ad_group_ad?.status,
                adGroup: a.ad_group?.name,
                campaign: a.campaign?.name,
                impressions: a.metrics?.impressions,
                clicks: a.metrics?.clicks,
                cost: a.metrics?.cost_micros ? (parseInt(String(a.metrics.cost_micros)) / 1000000).toFixed(2) : "0.00",
            }))
        );
    } catch (error) {
        console.error("Error running ads query:", error);
    }
}

/**
 * Run a query to get account performance
 */
async function runAccountPerformanceQuery(): Promise<void> {
    try {
        const client = initializeClient();
        const customer = client.Customer({
            customer_id: config.login_customer_id!,
            refresh_token: config.refresh_token!,
            login_customer_id: config.login_customer_id,
            linked_customer_id: config.linked_customer_id,
        });

        const performance = await customer.report({
            entity: "customer",
            attributes: ["customer.id", "customer.descriptive_name"],
            metrics: [
                "metrics.impressions",
                "metrics.clicks",
                "metrics.cost_micros",
                "metrics.conversions",
                "metrics.conversions_value",
                "metrics.average_cpc",
                "metrics.ctr",
            ],
            date_constant: "LAST_30_DAYS",
        });

        if (performance.length > 0) {
            const p = performance[0];
            console.log("\nAccount Performance (Last 30 Days):");
            console.table([
                {
                    account: p.customer?.descriptive_name,
                    impressions: p.metrics?.impressions,
                    clicks: p.metrics?.clicks,
                    ctr: p.metrics?.ctr ? `${(parseFloat(String(p.metrics.ctr)) * 100).toFixed(2)}%` : "0.00%",
                    avgCpc: p.metrics?.average_cpc
                        ? `$${(parseInt(String(p.metrics.average_cpc)) / 1000000).toFixed(2)}`
                        : "$0.00",
                    cost: p.metrics?.cost_micros
                        ? `$${(parseInt(String(p.metrics.cost_micros)) / 1000000).toFixed(2)}`
                        : "$0.00",
                    conversions: p.metrics?.conversions,
                    convValue: p.metrics?.conversions_value,
                },
            ]);
        } else {
            console.log("No account performance data available");
        }
    } catch (error) {
        console.error("Error running account performance query:", error);
    }
}

/**
 * Run a query to get campaign performance
 */
async function runCampaignPerformanceQuery(): Promise<void> {
    try {
        const client = initializeClient();
        const customer = client.Customer({
            customer_id: config.login_customer_id!,
            refresh_token: config.refresh_token!,
            login_customer_id: config.login_customer_id,
            linked_customer_id: config.linked_customer_id,
        });

        const performance = await customer.report({
            entity: "campaign",
            attributes: ["campaign.id", "campaign.name", "campaign.status"],
            metrics: [
                "metrics.impressions",
                "metrics.clicks",
                "metrics.cost_micros",
                "metrics.conversions",
                "metrics.average_cpc",
                "metrics.ctr",
            ],
            date_constant: "LAST_30_DAYS",
            limit: 20,
        });

        console.log("\nCampaign Performance (Last 30 Days):");
        console.table(
            performance.map((p) => ({
                id: p.campaign?.id,
                name: p.campaign?.name,
                status: p.campaign?.status,
                impressions: p.metrics?.impressions,
                clicks: p.metrics?.clicks,
                ctr: p.metrics?.ctr ? `${(parseFloat(String(p.metrics.ctr)) * 100).toFixed(2)}%` : "0.00%",
                avgCpc: p.metrics?.average_cpc
                    ? `$${(parseInt(String(p.metrics.average_cpc)) / 1000000).toFixed(2)}`
                    : "$0.00",
                cost: p.metrics?.cost_micros
                    ? `$${(parseInt(String(p.metrics.cost_micros)) / 1000000).toFixed(2)}`
                    : "$0.00",
                conversions: p.metrics?.conversions,
            }))
        );
    } catch (error) {
        console.error("Error running campaign performance query:", error);
    }
}

/**
 * Run a custom GAQL query
 */
async function runCustomQuery(): Promise<void> {
    const gaqlQuery = await new Promise<string>((resolve) => {
        console.log("\nEnter your GAQL query:");
        console.log("Example: SELECT campaign.id, campaign.name, metrics.impressions FROM campaign");
        rl.question("> ", (answer) => {
            resolve(answer);
        });
    });

    try {
        const client = initializeClient();
        const customer = client.Customer({
            customer_id: config.login_customer_id!,
            refresh_token: config.refresh_token!,
            login_customer_id: config.login_customer_id,
            linked_customer_id: config.linked_customer_id,
        });

        const results = await customer.query(gaqlQuery);
        console.log("\nQuery Results:");
        console.log(JSON.stringify(results, null, 2));
    } catch (error) {
        console.error("Error running custom query:", error);
    }
}

/**
 * Main function to run the playground
 */
async function main(): Promise<void> {
    console.log("========================================");
    console.log("Google Ads API Testing Playground");
    console.log("========================================");

    // Check if config needs to be set up
    await promptForMissingConfig();

    // Test the API connection
    await runTestQuery();

    // Show example queries menu
    await showExampleQueriesMenu();

    rl.close();
}

// Run the playground
main()
    .catch(console.error)
    .finally(() => {
        rl.close();
        process.exit(0);
    });
