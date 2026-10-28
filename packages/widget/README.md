# @lean-harness/widget

`<lean-chat>`: a drop-in chat web component for any [Lean Harness](https://github.com/ikevinsolomon/lean-harness) server.
Works in any page or framework: inline, as a floating button, or as a full-page app.

```html
<script type="module" src="https://your-server/lean-chat.js"></script>
<lean-chat endpoint="https://your-server" mode="floating" heading="Support"></lean-chat>
```

The API client on its own, for building your own UI:

```ts
import { HarnessClient } from '@lean-harness/widget/client';

const client = new HarnessClient('https://your-server');
const session = await client.createSession();
for await (const event of client.send(session.id, 'Hello')) console.log(event);
```
