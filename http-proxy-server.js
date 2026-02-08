const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 80; // Puerto HTTP estándar

// Middleware para parsear JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Endpoint HTTP que redirige a Vercel HTTPS
app.post('/obd', async (req, res) => {
  try {
    console.log(`📡 HTTP Request recibido - redirigiendo a Vercel HTTPS`);
    console.log(`📊 Datos:`, JSON.stringify(req.body, null, 2));
    
    // Reenviar a Vercel HTTPS
    const response = await axios.post('https://fix-woad.vercel.app/obd', req.body, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Respuesta de Vercel:`, response.data);
    
    // Devolver la respuesta de Vercel
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Error reenviando a Vercel:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error reenviando datos a Vercel',
      error: error.message
    });
  }
});

// Endpoint de salud
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Servidor HTTP proxy funcionando',
    target: 'https://fix-woad.vercel.app',
    timestamp: new Date().toISOString()
  });
});

// Redirigir todas las demás rutas a HTTPS
app.get('*', (req, res) => {
  const httpsUrl = `https://fix-woad.vercel.app${req.path}`;
  res.redirect(301, httpsUrl);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor HTTP proxy ejecutándose en puerto ${PORT}`);
  console.log(`📡 Endpoint para dispositivos: http://[TU-IP]:${PORT}/obd`);
  console.log(`🔄 Redirige a: https://fix-woad.vercel.app/obd`);
  console.log(`💡 Configura tu dispositivo con: [TU-IP]/obd y puerto 80`);
}).on('error', (err) => {
  console.error('❌ Error del servidor:', err);
});

module.exports = app;