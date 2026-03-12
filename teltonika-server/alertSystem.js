// Sistema de detección de alertas en tiempo real
const ALERT_THRESHOLDS = {
  coolantTemp: { warning: 95, critical: 105 },
  engineRpm: { warning: 5500, critical: 6500 },
  vehicleSpeed: { warning: 120, critical: 150 },
  engineLoad: { warning: 85, critical: 95 },
  batteryVoltage: { low: 11.5, critical: 11.0 }
};

function checkAlerts(data, io) {
  const alerts = [];

  // Temperatura crítica
  if (data.coolantTemp >= ALERT_THRESHOLDS.coolantTemp.critical) {
    const alert = {
      type: 'critical',
      category: 'temperature',
      title: 'TEMPERATURA CRÍTICA',
      message: `Temperatura: ${data.coolantTemp}°C`,
      value: data.coolantTemp,
      deviceId: data.deviceId,
      timestamp: data.timestamp
    };
    alerts.push(alert);
    io.emit('critical-alert', alert);
  } else if (data.coolantTemp >= ALERT_THRESHOLDS.coolantTemp.warning) {
    const alert = {
      type: 'warning',
      category: 'temperature',
      title: 'Temperatura Alta',
      message: `Temperatura: ${data.coolantTemp}°C`,
      value: data.coolantTemp,
      deviceId: data.deviceId,
      timestamp: data.timestamp
    };
    alerts.push(alert);
    io.to(`device-${data.deviceId}`).emit('alert', alert);
  }

  // RPM crítico
  if (data.engineRpm >= ALERT_THRESHOLDS.engineRpm.critical) {
    const alert = {
      type: 'critical',
      category: 'rpm',
      title: 'RPM CRÍTICO',
      message: `RPM: ${data.engineRpm}`,
      value: data.engineRpm,
      deviceId: data.deviceId,
      timestamp: data.timestamp
    };
    alerts.push(alert);
    io.emit('critical-alert', alert);
  }

  // Velocidad excesiva
  if (data.vehicleSpeed >= ALERT_THRESHOLDS.vehicleSpeed.critical) {
    const alert = {
      type: 'critical',
      category: 'speed',
      title: 'VELOCIDAD EXCESIVA',
      message: `Velocidad: ${data.vehicleSpeed} km/h`,
      value: data.vehicleSpeed,
      deviceId: data.deviceId,
      timestamp: data.timestamp
    };
    alerts.push(alert);
    io.emit('critical-alert', alert);
  }

  // Batería crítica
  if (data.batteryVoltage && data.batteryVoltage <= ALERT_THRESHOLDS.batteryVoltage.critical) {
    const alert = {
      type: 'critical',
      category: 'battery',
      title: 'BATERÍA CRÍTICA',
      message: `Voltaje: ${data.batteryVoltage}V`,
      value: data.batteryVoltage,
      deviceId: data.deviceId,
      timestamp: data.timestamp
    };
    alerts.push(alert);
    io.emit('critical-alert', alert);
  }

  return alerts;
}

module.exports = { checkAlerts, ALERT_THRESHOLDS };
