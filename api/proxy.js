
export default async function handler(req, res) {
  // 1. Configurer les en-têtes CORS pour autoriser votre frontend
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // 2. Répondre immédiatement aux requêtes OPTIONS (pre-flight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 3. Traiter la requête POST
  try {
    const { endpoint, body, apiKey } = req.body;

    if (!endpoint || !apiKey) {
      return res.status(400).json({ error: "Endpoint ou API Key manquant." });
    }

    // Appel serveur vers serveur (pas de CORS ici)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    // Renvoyer la réponse exacte de Hugging Face (succès ou erreur)
    return res.status(response.status).json(data);

  } catch (error) {
    console.error("Proxy Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
