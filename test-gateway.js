import axios from 'axios';

const PORT = 3000;
const GATEWAY_URL = `http://localhost:${PORT}/v1/chat/completions`;

async function testGateway() {
  console.log('----------------------------------------------------');
  console.log(`Starting LLM Free Pool Gateway routing test...`);
  console.log(`Target endpoint: ${GATEWAY_URL}`);
  console.log('----------------------------------------------------');

  try {
    const payload = {
      model: 'fast-flash', // Requests the fast flash pool
      messages: [
        { role: 'user', content: 'Say hello and tell me what the speed of light is in one short sentence.' }
      ],
      temperature: 0.7,
      stream: false
    };

    console.log(`Sending non-stream test request to gateway...`);
    const start = Date.now();
    const response = await axios.post(GATEWAY_URL, payload, { timeout: 15000 });
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    console.log(`\nResponse received successfully in ${duration} seconds:`);
    console.log(JSON.stringify(response.data, null, 2));
    console.log('\nResult content:');
    console.log(response.data.choices[0].message.content);
    console.log('----------------------------------------------------');
    console.log('Test PASSED!');
  } catch (err) {
    console.error('\nTest FAILED!');
    if (err.response) {
      console.error(`Status code: ${err.response.status}`);
      console.error('Error details:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('Error message:', err.message);
    }
  }
}

testGateway();
