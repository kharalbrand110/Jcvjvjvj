module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const base = process.env.APK_BUILDER_URL;
  if (!base) {
    return res.status(503).json({
      error: "The website is deployed, but the real APK build server is not connected yet. Set APK_BUILDER_URL in Vercel Environment Variables."
    });
  }

  try {
    const upstream = await fetch(base.replace(/\/+$/, "") + "/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {})
    });

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);

    const disposition = upstream.headers.get("content-disposition");
    if (disposition) res.setHeader("Content-Disposition", disposition);

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(buffer);
  } catch (err) {
    return res.status(502).json({
      error: "Could not reach the APK build server. Check APK_BUILDER_URL and make sure the build server is online."
    });
  }
};
