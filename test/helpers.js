// Fake fetch factory: returns queued Response objects and records calls.
export function fakeFetch(...responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (!responses.length) throw new Error(`unexpected fetch call to ${url}`);
    return responses.shift();
  };
  impl.calls = calls;
  return impl;
}

export function jsonRes(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export const quietStderr = { write() {} };
