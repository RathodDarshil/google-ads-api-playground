# Google Ads Research Tool

A powerful command-line tool for querying and analyzing Google Ads data using the Google Ads API. This tool allows you to authenticate with the Google Ads API and run GAQL (Google Ads Query Language) queries to fetch and analyze advertising data from your Google Ads accounts.

## Features

-   OAuth2 authentication flow with Google Ads API
-   Interactive command-line interface
-   Support for custom GAQL queries
-   Automatic refresh token management
-   Designed for both exploratory research and data extraction

## Prerequisites

Before using this tool, you need:

1. A Google Ads developer token (with API access approval)
2. A Google Ads Manager (MCC) account
3. OAuth 2.0 client credentials (client ID and client secret)
4. Node.js (v14 or later) and npm installed

## Installation

1. Clone this repository:

    ```bash
    git clone <repository-url>
    cd google-ads-research
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Configure your environment variables by creating a `.env` file based on the provided `.env.example`:

    ```
    GOOGLE_ADS_DEVELOPER_TOKEN=your_developer_token
    GOOGLE_ADS_CLIENT_ID=your_oauth_client_id
    GOOGLE_ADS_CLIENT_SECRET=your_oauth_client_secret
    GOOGLE_ADS_LOGIN_CUSTOMER_ID=your_mcc_id_without_dashes
    ```

    Optionally, you can also add:

    ```
    GOOGLE_ADS_REFRESH_TOKEN=your_refresh_token
    GOOGLE_ADS_LINKED_CUSTOMER_ID=your_ads_account_id_without_dashes
    ```

## Usage

Run the tool with:

```bash
npm start
```

If you don't have all required configuration values in your `.env` file, the tool will prompt you to enter them interactively. If you don't have a refresh token, the tool will guide you through the OAuth authentication flow to generate one.

### Running GAQL Queries

The tool supports running GAQL (Google Ads Query Language) queries against your Google Ads accounts. When using the tool, **paste your query as a single line** in the command-line interface, even though the example below is shown in multiple lines for readability:

```
SELECT
  campaign.id,
  campaign.name,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros
FROM campaign
WHERE metrics.impressions > 0
ORDER BY metrics.cost_micros DESC
```

As a single line, this would be:

```
SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign WHERE metrics.impressions > 0 ORDER BY metrics.cost_micros DESC
```

The tool will execute your query, display the results, and provide options for saving the data.

## Authentication Flow

If you don't have a refresh token in your `.env` file, the tool will:

1. Generate an authorization URL
2. Ask you to open the URL in your browser
3. Prompt you to log in with your Google account and authorize the application
4. Ask you to paste the authorization code from the redirect URL
5. Exchange the code for a refresh token
6. Save the refresh token to your `.env` file for future use

## Development

### Scripts

-   `npm start`: Run the tool
-   `npm run build`: Build the TypeScript code
-   `npm run dev`: Run with auto-reload during development

### Project Structure

-   `googleAdsQueryTool.ts`: Main script containing the tool's logic
-   `.env.example`: Example environment variables
-   `tsconfig.json`: TypeScript configuration
-   `package.json`: Project dependencies and scripts

## Error Handling

The tool includes error handling for common issues such as:

-   Invalid credentials
-   Missing authentication
-   API access restrictions
-   Rate limiting
-   Malformed GAQL queries

If you encounter persistent errors, check your Google Ads API access permissions and developer token status.

## Security Notes

-   Your Google Ads API credentials are stored locally in the `.env` file
-   Never commit your `.env` file to version control
-   The tool uses OAuth 2.0 for secure authentication with Google's services

## License

ISC
