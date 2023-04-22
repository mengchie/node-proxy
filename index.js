const net = require('net');
const dgram = require('dgram');
const dns = require('dns');
const ipAddr = require('ip').address(); // Get the IP address of the machine

const udpServer = dgram.createSocket('udp4');
const port = process.env.port || 8080;

udpServer.on('message', (msg, rinfo) => {
  console.log(`Received request from ${rinfo.address}:${rinfo.port}: ${msg}`);
  const client = dgram.createSocket('udp4');

  client.on('message', (response) => {
    console.log(`Received response from ${rinfo.address}:${rinfo.port}: ${response}`);
    // modify the source IP and port of the response
    const newResponse = Buffer.concat([
      Buffer.from(rinfo.address.split('.').map(Number)),
      Buffer.from([rinfo.port >> 8, rinfo.port & 0xFF]),
      response
    ]);

    // send the modified response back to the original client
    udpServer.send(newResponse, 0, newResponse.length, rinfo.port, rinfo.address, (err) => {
      if (err) console.log(`Error sending response: ${err}`);
    });

    client.close();
  });

  // send the original message to its destination
  client.send(msg, 0, msg.length, rinfo.port, rinfo.address, (err) => {
    if (err) console.log(`Error sending message: ${err}`);
  });
});

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`UDP forward proxy udpServer listening on ${address.address}:${address.port}`);
});

udpServer.bind(port);

const server = net.createServer();
server.on('connection', (clientToProxySocket) => {
  console.log('Client Connected To Proxy');
  // We need only the data once, the starting packet
  clientToProxySocket.once('data', async (data) => {
    let isTLSConnection = data.toString().indexOf('CONNECT') !== -1;
  
    //Considering Port as 80 by default 
    let serverPort = 80;
    let serverAddress;
    if (isTLSConnection) {
      // Port changed to 443, parsing the host from CONNECT 
      serverPort = 443;
      serverAddress = data.toString()
                          .split('CONNECT ')[1]
                          .split(' ')[0].split(':')[0];
    } else {
       // Parsing HOST from HTTP
       serverAddress = data.toString()
                           .split('Host: ')[1].split('\r\n')[0];
    }
    try {
      const result = await dns.promises.lookup(serverAddress);
    } catch (err) {
      console.error(`Error looking up hostname ${serverAddress}: ${err.message}`);
      return
    }

    let proxyToServerSocket = net.createConnection({
      host: serverAddress,
      port: serverPort
    }, () => {
      console.log(`PROXY TO SERVER SET UP: Host - ${serverAddress}`);
      
      if (isTLSConnection) {
        //Send Back OK to HTTPS CONNECT Request
        clientToProxySocket.write('HTTP/1.1 200 OK\r\n\n');
      } else {
        proxyToServerSocket.write(data);
      }
      // Piping the sockets
      clientToProxySocket.pipe(proxyToServerSocket);
      proxyToServerSocket.pipe(clientToProxySocket);
      
      proxyToServerSocket.on('error', (err) => {
        console.log('PROXY TO SERVER ERROR');
        console.log(err);
        if (err.code === 'ENOTFOUND') {
          console.log('DNS LOOKUP FAILED');
          clientToProxySocket.destroy();
        }
      });
    });

    clientToProxySocket.on('error', err => {
      console.log('CLIENT TO PROXY ERROR');
      console.log(err);
      if (err.code === 'ENOTFOUND') {
        console.log('DNS LOOKUP FAILED');
        clientToProxySocket.destroy();
      }
    });

  }).on('error', (err) => {
    console.log('CLIENT TO PROXY SOCKET ERROR');
    console.error(err);
    clientToProxySocket.destroy();
  });
});
server.on('error', (err) => {
  console.log('SERVER ERROR');
  console.log(err);
});
server.on('close', () => {
  console.log('Client Disconnected');
});
server.listen(port, () => {
  console.log(`Server running at ${ipAddr}:${port}/`);
});