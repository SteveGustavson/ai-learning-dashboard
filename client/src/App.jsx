import React, { useEffect, useState } from 'react';
import { Button, Card, Text, Switch, tokens } from '@fluentui/react-components';
import ChatPanel from './ChatPanel';

export default function App({ dark, setDark }) {
  const [resources, setResources] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetch('/api/resources').then(r => r.json()).then(j => setResources(j.resources || []));
  }, []);

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      gap: 16,
      padding: 24,
      background: dark ? '#1e1e1e' : '#f3f4f6',
      color: dark ? '#fff' : '#000'
    }}>
      <div style={{ width: 320 }}>
        <h2>AI Learning Dashboard</h2>
        <Switch checked={dark} onChange={(_, d) => setDark(d.checked)} label={dark ? 'Dark' : 'Light'} />
        {resources.map(r => (
          <Card key={r.id} style={{ marginTop: 12, padding: 12 }}>
            <Text weight="semibold">{r.title}</Text>
            <div>{r.track} • {r.level}</div>
            <Button appearance="primary" onClick={() => setSelected(r)}>Open</Button>
          </Card>
        ))}
      </div>
      <div style={{ flex: 1, padding: 12 }}>
        {selected ? (
          <>
            <h3>{selected.title}</h3>
            <p>{selected.summary}</p>
          </>
        ) : <p>Select a resource to start.</p>}
      </div>
      <div style={{ width: 420, paddingLeft: 12, borderLeft: '1px solid #ccc' }}>
        <ChatPanel resource={selected} dark={dark} />
      </div>
    </div>
  );
}
