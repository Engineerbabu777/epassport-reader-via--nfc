📱 ePassport NFC Reader

A mobile + backend solution for securely reading ePassport data over NFC.
This project demonstrates how to use NFC-enabled smartphones to access biometric and personal information stored in an electronic passport’s chip (ICAO 9303 standard).

✨ Features

🔑 BAC (Basic Access Control) using MRZ data (passport number, DOB, expiry date)

📖 Read DG1 (Personal Data) → Name, DOB, Document Number, Nationality

🖼️ Read DG2 (Face Image) and decode to a displayable image

🔒 Secure communication with the chip using NFC protocols

📲 Works with Android (NFC-enabled devices) and can be integrated with React Native / Expo frontends

🌐 Optional Flask backend for image processing and storage

🛠️ Tech Stack

Frontend (Mobile) → React Native / Expo

NFC Communication → Android NFC API / React Native NFC Manager

Backend (Optional) → Flask + OpenCV + Pillow

File Handling → Store images locally or send to backend for processing

🚀 Use Cases

Mobile KYC (Know Your Customer)

Border control and identity verification apps

Secure identity onboarding for banks, travel, and government services

⚠️ Disclaimer: This project is for educational and research purposes only. Always comply with local laws and regulations when accessing or processing identity documents.
