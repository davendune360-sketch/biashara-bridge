# Biashara Bridge

**A simple business management platform for small businesses.**

Biashara Bridge is a Kenya-focused web application designed to help small businesses manage orders, customers, products, stock, payments, and sales in one place.

It provides a simple workspace for managing orders coming from channels such as **WhatsApp, Instagram, and walk-in sales**, while providing a foundation for future cloud-based business management.

## Live Project

**Biashara Bridge:** https://biasharabridge.netlify.app/

## Features

### Order Management

* Record customer orders and sales.
* Track order status through **Pending, Paid, Preparing, and Delivered**.
* Mark pending orders as paid.
* Record the quantity, unit price, product variation, and delivery notes.
* Automatically calculate order totals.
* Record optional M-Pesa transaction codes.
* Print customer receipts.
* Record the date products were sold.

### Customer Management

* Create customer profiles with:

  * Name
  * Phone number
  * Email
  * Delivery area
  * Notes
* Automatically add customers when saving an order.
* Edit customer information.
* Apply corrected customer names to their previous orders.
* Remove customers from the directory without deleting their historical sales records.

### Product & Stock Management

* Manage products and stock quantities.
* Organize products by category.
* Assign product/SKU codes.
* Define selling units such as:

  * Piece
  * Pair
  * Pack
  * Kilogram
  * Litre
  * Service
* Support product variants such as size, colour, and package type.
* Restock products without changing their sales history.
* Edit and remove products.
* Configure low-stock alert thresholds.

### Business Profile

Business owners can configure:

* Business name
* Owner/staff name
* Business phone number
* Logo or profile picture

### Data Management

* Store business data locally using browser local storage.
* Export business data as a JSON backup.
* Restore previously exported data on the same or another browser.
* Continue using the application locally without requiring an account or server.

## Technology Stack

* **HTML5** — application structure
* **CSS3** — responsive interface and styling
* **JavaScript** — application logic and data management
* **Supabase** — cloud database and authentication foundation
* **Git & GitHub** — source control and project management
* **Netlify** — deployment and hosting

## Cloud Architecture

The project includes a Supabase database foundation defined in:

`supabase-schema.sql`

The schema provides a data model for:

* Businesses
* Customers
* Products
* Orders

Row-level security is included to ensure that authenticated businesses can access only their own records.

The application also includes a client configuration module for connecting the frontend to Supabase.

## Local Development

Because Biashara Bridge is currently a frontend application, it can be opened directly in a modern web browser.

### Run locally

1. Clone or download the repository.
2. Open the project folder.
3. Open `index.html` in Chrome, Microsoft Edge, or another modern browser.
4. Select **Load example data** to explore the application.
5. Select **Add new order** to begin entering data.

No local server is required for the basic local-mode experience.

## Project Structure

```text
biashara-bridge/
│
├── index.html
├── styles.css
├── app.js
├── cloud-config.js
├── supabase-schema.sql
├── README.md
└── .gitignore
```

## Data Storage

In local mode, orders, customers, products, and other business information are stored in the browser's local storage.

This allows the application to work without requiring a user account or continuously connected server.

The Supabase integration provides the foundation for moving from local-only storage toward synchronized cloud data.

## Development Status

**Status: In Development**

Biashara Bridge is an actively developed project. The current version focuses on creating a practical and easy-to-use business management interface for small businesses.

Future development can expand the platform with features such as:

* Full cloud synchronization
* User accounts and business authentication
* Automated M-Pesa payment confirmation
* WhatsApp order notifications and reminders
* Sales and inventory reports
* Business analytics
* Multi-device synchronization
* Improved receipt and report generation

## Why Biashara Bridge?

Many small businesses manage orders through multiple channels and may rely on notebooks, spreadsheets, or messaging applications to keep track of sales and customers.

Biashara Bridge explores how a simple web application can bring these activities into a single workspace while remaining accessible to small businesses.

## Author

**David Kamau**

Electrical & Communications Engineering Student | Aspiring Web Developer

Interested in:

* Web development
* Software development
* Telecommunications
* Electrical engineering
* Technology and innovation

## License

This project is currently intended as a personal development and portfolio project.
