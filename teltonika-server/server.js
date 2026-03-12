const net = require('net');
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const TeltonikaParser = require('complete-teltonika-parser');
const { checkAlerts } = require('./alertSystem');
require('dotenv').config();

// ============================================
// CONFIGURACIÓN
// ============================================

const TCP_PORT = process.env.TCP_PORT || 8080;
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fix-teltonika';

// ============================================
// EXPRESS + SOCKET.IO SETUP
// ============================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// ============================================
// MODELO DE DATOS MONGODB
// ============================================

const TelemetrySchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  imei: { type: String, required: true },
  timestamp: { type: Date, required: true, index: true },
  
  // GPS
  latitude: Number,
  longitude: Number,
  altitude: Number,
  angle: Number,
  speed: Number,
  satellites: Number,
  
  // OBD2
  engineRpm: Number,
  vehicleSpeed: Number,
  coolantTemp: Number,
  fuelLevel: Number,
  engineLoad: Number,
  throttlePosition: Number,
  
  // Estado del vehículo
  ignition: Boolean,
  movement: Boolean,
  
  // Batería y señal
  batteryVoltage: Number,
  gsmSignal: Number,
  
  // Datos raw completos
  rawData: mongoose.Schema.Types.Mixed,
  
  // Metadata
  receivedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Índice compuesto para consultas rápidas
TelemetrySchema.index({ deviceId: 1, timestamp: -1 });

const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// ============================================
// ALMACENAMIENTO EN MEMORIA (CACHE)
// ============================================

const deviceCache = new Map(); // Almacena últimos datos por dispositivo
let connectedClients = 0; // Contador de clientes Socket.IO conectados

// ============================================
// SOCKET.IO - TIEMPO REAL
// ============================================

io.on('connection', (socket) => {
  connectedClients++;
  console.log(`🔌 Cliente conectado via Socket.IO (Total: ${connectedClients})`);
  
  // Enviar datos actuales al conectarse
  socket.emit('devices', Array.from(deviceCache.keys()));
  
  // Suscribirse a un dispositivo específico
  socket.on('subscribe', (deviceId) => {
    socket.join(`device-${deviceId}`);
    console.log(`📡 Cliente suscrito a dispositivo: ${deviceId}`);
    
    // Enviar último dato disponible
    const latestData = deviceCache.get(deviceId);
    if (latestData) {
      socket.emit('telemetry', latestData);
    }
  });
  
  // Desuscribirse
  socket.on('unsubscribe', (deviceId) => {
    socket.leave(`device-${deviceId}`);
    console.log(`📴 Cliente desuscrito de dispositivo: ${deviceId}`);
  });
  
  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`🔌 Cliente desconectado (Total: ${connectedClients})`);
  });
});

// ============================================
// PARSER TELTONIKA
// ============================================

function parseTeltonikaData(buffer, imei) {
  try {
    const parser = new TeltonikaParser(buffer);
    const parsed = parser.getAvlData();
    
    if (!parsed || !parsed.records) {
      console.log('⚠️  No se pudieron parsear los datos');
      return null;
    }
    
    console.log(`✅ Parseados ${parsed.records.length} registros del dispositivo ${imei}`);
    
    // Convertir cada registro a formato JSON limpio
    const records = parsed.records.map(record => {
      const data = {
        deviceId: imei,
        imei: imei,
        timestamp: new Date(record.timestamp),
        
        // GPS
        latitude: record.gps?.latitude || null,
        longitude: record.gps?.longitude || null,
        altitude: record.gps?.altitude || null,
        angle: record.gps?.angle || null,
        speed: record.gps?.speed || null,
        satellites: record.gps?.satellites || null,
        
        // Buscar parámetros OBD2 en los IO elements
        engineRpm: findIOElement(record.ioElements, [110, 111]) || null,
        vehicleSpeed: findIOElement(record.ioElements, [24]) || null,
        coolantTemp: findIOElement(record.ioElements, [112]) || null,
        fuelLevel: findIOElement(record.ioElements, [113]) || null,
        engineLoad: findIOElement(record.ioElements, [114]) || null,
        throttlePosition: findIOElement(record.ioElements, [115]) || null,
        
        // Estado
        ignition: findIOElement(record.ioElements, [239]) === 1,
        movement: findIOElement(record.ioElements, [240]) === 1,
        
        // Batería y señal
        batteryVoltage: findIOElement(record.ioElements, [67]) || null,
        gsmSignal: findIOElement(record.ioElements, [21]) || null,
        
        // Datos raw completos
        rawData: record
      };
      
      return data;
    });
    
    return records;
    
  } catch (error) {
    console.error('❌ Error parseando datos Teltonika:', error.message);
    return null;
  }
}

// Función auxiliar para buscar elementos IO
function findIOElement(ioElements, ids) {
  if (!ioElements) return null;
  
  for (const id of ids) {
    if (ioElements[id] !== undefined) {
      return ioElements[id];
    }
  }
  
  return null;
}

// ============================================
// GUARDAR EN BASE DE DATOS
// ============================================

async function saveTelemetry(records) {
  try {
    if (!records || records.length === 0) return;
    
    // Guardar en MongoDB
    await Telemetry.insertMany(records);
    
    // Procesar cada registro para alertas y emisión en tiempo real
    for (const record of records) {
      // Actualizar cache
      deviceCache.set(record.deviceId, record);
      
      // 🚨 DETECTAR ALERTAS INSTANTÁNEAMENTE
      const alerts = checkAlerts(record, io);
      
      // Emitir datos en tiempo real
      io.to(`device-${record.deviceId}`).emit('telemetry', record);
      
      // Si hay alertas, emitirlas también
      if (alerts.length > 0) {
        io.to(`device-${record.deviceId}`).emit('alerts', alerts);
        console.log(`🚨 ${alerts.length} alertas detectadas para ${record.deviceId}`);
      }
    }
    
    // Notificar actualización general
    const latestRecord = records[records.length - 1];
    io.emit('device-update', {
      deviceId: latestRecord.deviceId,
      timestamp: latestRecord.timestamp
    });
    
    console.log(`💾 ${records.length} registros guardados y emitidos`);
    
  } catch (error) {
    console.error('❌ Error guardando telemetría:', error.message);
  }
}

// ============================================
// SERVIDOR TCP (RECIBE DATOS TELTONIKA)
// ============================================

const tcpServer = net.createServer((socket) => {
  console.log(`📡 Nueva conexión TCP desde ${socket.remoteAddress}:${socket.remotePort}`);
  
  let imei = null;
  let buffer = Buffer.alloc(0);
  
  socket.on('data', async (data) => {
    buffer = Buffer.concat([buffer, data]);
    
    // Primer mensaje: IMEI (15 bytes)
    if (!imei && buffer.length >= 17) {
      const imeiLength = buffer.readUInt16BE(0);
      
      if (imeiLength === 15 && buffer.length >= 17) {
        imei = buffer.slice(2, 17).toString();
        console.log(`📱 IMEI recibido: ${imei}`);
        
        // Responder con ACK (0x01)
        socket.write(Buffer.from([0x01]));
        
        // Limpiar buffer
        buffer = buffer.slice(17);
      }
    }
    
    // Mensajes subsecuentes: Datos Teltonika
    if (imei && buffer.length > 0) {
      try {
        // Parsear datos
        const records = parseTeltonikaData(buffer, imei);
        
        if (records && records.length > 0) {
          // Guardar en base de datos
          await saveTelemetry(records);
          
          // Responder con número de registros recibidos
          const recordCount = Buffer.alloc(4);
          recordCount.writeUInt32BE(records.length, 0);
          socket.write(recordCount);
          
          console.log(`✅ Procesados ${records.length} registros de ${imei}`);
          
          // Limpiar buffer
          buffer = Buffer.alloc(0);
        }
        
      } catch (error) {
        console.error('❌ Error procesando datos:', error.message);
      }
    }
  });
  
  socket.on('end', () => {
    console.log(`🔌 Conexión cerrada: ${imei || 'desconocido'}`);
  });
  
  socket.on('error', (error) => {
    console.error(`❌ Error en socket: ${error.message}`);
  });
});

tcpServer.listen(TCP_PORT, () => {
  console.log(`🚀 Servidor TCP Teltonika escuchando en puerto ${TCP_PORT}`);
});

// ============================================
// SERVIDOR HTTP/REST API (SIRVE DATOS JSON)
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Fix Teltonika Server',
    tcp_port: TCP_PORT,
    http_port: HTTP_PORT,
    mongodb: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    active_devices: deviceCache.size,
    connected_clients: connectedClients,
    socketio: 'Active',
    timestamp: new Date().toISOString()
  });
});

// Listar dispositivos activos
app.get('/api/devices', async (req, res) => {
  try {
    const devices = await Telemetry.distinct('deviceId');
    
    const devicesWithLastData = await Promise.all(
      devices.map(async (deviceId) => {
        const lastRecord = await Telemetry
          .findOne({ deviceId })
          .sort({ timestamp: -1 })
          .lean();
        
        return {
          deviceId,
          imei: lastRecord?.imei,
          lastSeen: lastRecord?.timestamp,
          connected: deviceCache.has(deviceId),
          lastData: deviceCache.get(deviceId) || lastRecord
        };
      })
    );
    
    res.json({
      success: true,
      count: devices.length,
      devices: devicesWithLastData
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener último dato de un dispositivo (TIEMPO REAL)
app.get('/api/devices/:deviceId/latest', (req, res) => {
  try {
    const { deviceId } = req.params;
    const latestData = deviceCache.get(deviceId);
    
    if (!latestData) {
      return res.status(404).json({
        success: false,
        message: 'Dispositivo no encontrado o sin datos recientes'
      });
    }
    
    res.json({
      success: true,
      data: latestData,
      cached: true
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener historial de telemetría
app.get('/api/devices/:deviceId/history', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { from, to, limit = 100 } = req.query;
    
    const query = { deviceId };
    
    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = new Date(parseInt(from));
      if (to) query.timestamp.$lte = new Date(parseInt(to));
    }
    
    const records = await Telemetry
      .find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();
    
    res.json({
      success: true,
      count: records.length,
      data: records
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener telemetría OBD2 específica
app.get('/api/devices/:deviceId/obd', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 50 } = req.query;
    
    const records = await Telemetry
      .find({ 
        deviceId,
        $or: [
          { engineRpm: { $ne: null } },
          { vehicleSpeed: { $ne: null } },
          { coolantTemp: { $ne: null } }
        ]
      })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .select('timestamp engineRpm vehicleSpeed coolantTemp fuelLevel engineLoad throttlePosition ignition')
      .lean();
    
    res.json({
      success: true,
      count: records.length,
      data: records
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener ubicación GPS actual
app.get('/api/devices/:deviceId/location', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    const record = await Telemetry
      .findOne({ 
        deviceId,
        latitude: { $ne: null },
        longitude: { $ne: null }
      })
      .sort({ timestamp: -1 })
      .select('timestamp latitude longitude altitude speed angle satellites')
      .lean();
    
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'No hay datos de ubicación disponibles'
      });
    }
    
    res.json({
      success: true,
      data: record
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Estadísticas del dispositivo
app.get('/api/devices/:deviceId/stats', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { hours = 24 } = req.query;
    
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const stats = await Telemetry.aggregate([
      {
        $match: {
          deviceId,
          timestamp: { $gte: since }
        }
      },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          avgSpeed: { $avg: '$vehicleSpeed' },
          maxSpeed: { $max: '$vehicleSpeed' },
          avgRpm: { $avg: '$engineRpm' },
          maxRpm: { $max: '$engineRpm' },
          avgTemp: { $avg: '$coolantTemp' },
          maxTemp: { $max: '$coolantTemp' },
          totalDistance: { $sum: { $multiply: ['$speed', 0.001] } } // Aproximado
        }
      }
    ]);
    
    res.json({
      success: true,
      period: `${hours} hours`,
      data: stats[0] || {}
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// CONECTAR A MONGODB E INICIAR SERVIDOR HTTP
// ============================================

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Conectado a MongoDB');
    
    server.listen(HTTP_PORT, () => {
      console.log(`🚀 Servidor HTTP/REST API escuchando en puerto ${HTTP_PORT}`);
      console.log(`📡 Socket.IO activo para tiempo real`);
      console.log(`📡 API disponible en http://localhost:${HTTP_PORT}/api`);
    });
  })
  .catch((error) => {
    console.error('❌ Error conectando a MongoDB:', error.message);
    process.exit(1);
  });

// ============================================
// MANEJO DE ERRORES Y CIERRE GRACEFUL
// ============================================

process.on('SIGINT', async () => {
  console.log('\n🛑 Cerrando servidores...');
  
  tcpServer.close();
  await mongoose.connection.close();
  
  console.log('✅ Servidores cerrados correctamente');
  process.exit(0);
});
