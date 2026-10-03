# Product Overview

## What We're Building
A web-based hotspot management and payment system that allows customers to purchase internet vouchers online and receive hotspot credentials instantly after payment. Admins can manage multiple MikroTik router locations, define plans, track sales, and monitor/retry failed voucher generations.

## Target Users
- **Customers**: People who want to buy internet access at a hotspot location. They register with email and password, select a plan, pay via Paystack, and receive their hotspot voucher on screen. They can retrieve past vouchers from their account.
- **Admin**: A single owner account that manages all locations, plans, vouchers, payments, and retries failed voucher generations from a dashboard.

## Core Value Proposition
Automate the entire voucher sale process - from payment to MikroTik hotspot user creation - without manual intervention, while giving the admin full visibility and control.

## MVP Scope
- Customer registration and login (email + password)
- Hotspot plan selection per location
- Paystack payment integration and server-side verification
- Automatic voucher generation on MikroTik router via REST API after payment
- Voucher display on screen and stored in database for later retrieval
- Customer voucher history page
- Admin dashboard: sales overview, voucher tracking, failed generation monitoring and retry
- Support for multiple hotspot locations (multiple MikroTik routers)

## Out of Scope for MVP
- SMS or WhatsApp voucher delivery
- Reseller accounts
- PPPoE management
- Multiple admin accounts
- Mobile app
