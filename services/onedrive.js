const axios = require("axios");
require("dotenv").config();

async function getAccessToken() {
  const url = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const form = new URLSearchParams();

  form.append("client_id", process.env.AZURE_CLIENT_ID);
  form.append("client_secret", process.env.AZURE_CLIENT_SECRET);
  form.append("scope", "https://graph.microsoft.com/.default");
  form.append("grant_type", "client_credentials");

  const res = await axios.post(url, form);
  return res.data.access_token;
}

async function uploadToOneDrive(buffer, filename, folderPath) {
  const token = await getAccessToken();

  const uploadUrl =
    `https://graph.microsoft.com/v1.0/me/drive/root:${folderPath}/${filename}:/content`;

  const res = await axios.put(uploadUrl, buffer, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream"
    }
  });

  return {
    id: res.data.id,
    webUrl: res.data.webUrl,
    downloadUrl: res.data["@microsoft.graph.downloadUrl"]
  };
}

module.exports = {
  uploadToOneDrive
};
