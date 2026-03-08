import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => {
  return new Response("Hello, world!", {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
});
