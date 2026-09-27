# Biashara Bridge

A beginner-friendly, Kenya-focused order tracker for small businesses. It helps a seller keep WhatsApp, Instagram and walk-in orders in one place, see total sales, identify pending payments, and build a simple customer list.

## Run it

1. Download or open this folder.
2. Double-click `index.html` to open it in Chrome, Edge, or another modern browser.
3. Select **Load example data** to explore, or choose **Add new order** to start using it.

No installation, account, server, or internet connection is required after the page has loaded once. Orders are saved only in that browser on that device using local storage.

## Cloud setup foundation

The file [supabase-schema.sql](supabase-schema.sql) defines the production data model for businesses, customers, products, and orders. It also enables row-level security so each signed-in business can access only its own records.

To connect the interface, create a Supabase project, enable email authentication, run `supabase-schema.sql` in the SQL editor, and add the project URL and anonymous key to a small client configuration module. The current interface remains usable in local mode until those credentials are available.

## New features

- Select **Mark paid** beside a pending order as soon as payment is received.
- Select the circle with your initials at the top-right to set your business name, your name, business phone, and a logo or profile picture.
- Search orders by customer name, item, or sales channel.
- Track products and stock, including a category, stock code, selling unit, and variants (such as size, colour, or package type).
- Use **Restock** on any product to add new delivered stock without changing its sales history.
- Edit or remove products from the stock list, and set the low-stock alert threshold.
- Record the exact quantity, unit price, product variation, and delivery/customer notes for every order; the total calculates automatically.
- Add customers separately with their contact details, email, delivery area, and notes; customers are also added automatically when you save an order.
- Edit any customer from the Customers section; name corrections are also applied to that customer's past orders.
- Remove a customer from the directory without deleting their past sales records.
- Add an optional M-Pesa transaction code, move orders through Pending, Paid, Preparing, and Delivered, and print a receipt.
- Record the date each product was sold; it appears in the order desk and on the receipt.
- Download a JSON backup of the business data and restore it on the same or another browser.
- When signed in with Supabase, products and stock sync across browsers; existing cloud stock is loaded when you sign in, and local stock is uploaded if the cloud inventory is empty.

## How it can become a product

The next version could add user accounts, cloud backup, M-Pesa payment confirmations, WhatsApp reminders, stock tracking, and downloadable reports. For a first real deployment, a beginner could keep this interface and connect it to Firebase or a small Flask backend.
