// Fake AISStream: expects a subscription, confirms it, then streams position reports for 30 vessels.
import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 9999 });
let n = 0;
wss.on('connection', ws => {
  console.log('[fake-ais] upstream connection', ++n);
  let timer = null;
  ws.on('message', raw => {
    const sub = JSON.parse(raw.toString());
    console.log('[fake-ais] subscription key=' + sub.APIKey + ' boxes=' + sub.BoundingBoxes.length + ' types=' + (sub.FilterMessageTypes || []).length);
    if (sub.APIKey !== 'SECRET123') { ws.send(JSON.stringify({ error: 'Api Key Is Not Valid' })); ws.close(); return; }
    ws.send(JSON.stringify({ MessageType: 'SubscriptionConfirmation', Message: { SubscriptionConfirmation: { CompressionEnabled: false } } }));
    if (timer) return;
    let tick = 0;
    timer = setInterval(() => {
      tick++;
      for (let i = 0; i < 30; i++) {
        const mmsi = 477000000 + i;
        const lat = 26.2 + (i % 5) * 0.2, lon = 56.0 + i * 0.05 + tick * 0.001;
        ws.send(JSON.stringify({ MessageType: 'PositionReport', MetaData: { MMSI: mmsi, ShipName: 'VESSEL ' + i, latitude: lat, longitude: lon }, Message: { PositionReport: { Latitude: lat, Longitude: lon, Cog: 90, Sog: 10, NavigationalStatus: 0 } } }));
        if (tick === 1) ws.send(JSON.stringify({ MessageType: 'ShipStaticData', MetaData: { MMSI: mmsi }, Message: { ShipStaticData: { Type: 80 + (i % 5), Name: 'VESSEL ' + i, Destination: 'AE JEA' } } }));
      }
    }, 1000);
  });
  ws.on('close', () => { console.log('[fake-ais] upstream closed'); clearInterval(timer); });
});
console.log('[fake-ais] listening 9999');
