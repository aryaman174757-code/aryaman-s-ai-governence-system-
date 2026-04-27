import admin from "firebase-admin";
import fs from "fs";
import path from "path";

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: config.projectId,
  });
}

export const adminDb = admin.firestore();
