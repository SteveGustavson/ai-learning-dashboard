import React, { useEffect, useState, useMemo } from 'react';
import { Button, Card, Text, Switch, Divider, Spinner } from '@fluentui/react-components';

export default function App({ dark, setDark }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Colors tuned for a11y in light mode; subtle in dark.
  const palette = useMemo(
    () => ({
      pageBg: dark ? '#1f1f1f' : '#f4f6f8',
      text: dark ? '#f3f3f3' : '#111827',
      subText: dark ? '#b5b5b5' : '#374151',
      railBg: dark ? '#181818' : '#ffffff',
      cardBg: dark ? '#222' : '#fff',
      border: dark ? '#34373b' : '#D1D5DB',
      accent: dark ? '#60a5fa' : '#1f6feb', // blue w/ good contrast
      divider: dark ? 'linear-gradient(to bottom, #2c2c2c, #3a3a3a)' : 'linear-gradient(to bottom, #E5E7EB, #D1D5DB)',
      chip: dark ? '#0b61a4' : '#e6f2ff',
      chipText: dark ? '#e6f3ff' : '#0b3d91',
    }),
    [dark]
  );

  async function loadNews({ bustCache = false } = {}) {
    setLoading(true);
    setErr('');
    try {
      const url = bustCache
        ? `/api/news?ts=${Date.now()}`
        : `/api/news`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const items = Array.isArray(j.items) ? j.items : [];
      setNews(items);
      if (items.length && !selected) setSelected(items[0]);
    } catch (e) {
      setErr(e.message || 'Failed to load news');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadNews({ bustCache: true });
    setRefreshing(false);
  };

  // Simple date helper
  const fmtDate = (d) => {
    if (!d) return '';
    try {
      const dt = new Date(d);
      return dt.toLocaleString();
    } catch {
      return d;
    }
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '340px 1fr 440px',
        gap: 16,
        height: '100vh',
        padding: 16,
        background: palette.pageBg,
        color: palette.text,
        boxSizing: 'border-box',
      }}
    >
      {/* Left rail: News list */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: palette.railBg,
          border: `1px solid ${palette.border}`,
          borderRadius: 12,
          overflow: 'hidden',
          minHeight: 0, // allow child to size for overflow scroll
        }}
      >
        <div
          style={{
            padding: '14px 14px 8px',
            borderBottom: `1px solid ${palette.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div>
            <Text as="h2" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              AI Radar
            </Text>
            <div style={{ fontSize: 12, color: palette.subText }}>
              Curated from BAIR, The Gradient, MSR, Google AI, DeepMind, arXiv
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Switch
              checked={dark}
              onChange={(_, data) => setDark(data.checked)}
              label={dark ? 'Dark' : 'Light'}
            />
            <Button appearance="primary" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>

        <div style={{ height: 4, background: palette.divider }} />

        <div
          style={{
            overflowY: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            minHeight: 0,
          }}
        >
          {loading && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8 }}>
              <Spinner size="small" />
              <span style={{ color: palette.subText }}>Loading latest items…</span>
            </div>
          )}

          {err && !loading && (
            <Card appearance="filled" style={{ background: palette.cardBg, border: `1px solid ${palette.border}`, padding: 12 }}>
              <Text weight="semibold">Couldn’t load news</Text>
              <div style={{ color: palette.subText, marginTop: 6, fontSize: 13 }}>{err}</div>
              <div style={{ marginTop: 10 }}>
                <Button onClick={onRefresh}>Try Again</Button>
              </div>
            </Card>
          )}

          {!loading && !err && news.length === 0 && (
            <div style={{ color: palette.subText, padding: 8, fontSize: 13 }}>
              No items yet. Try Refresh.
            </div>
          )}

          {!loading &&
            !err &&
            news.map((n) => (
              <button
                key={n.id || n.link}
                onClick={() => setSelected(n)}
                style={{
                  textAlign: 'left',
                  background: selected?.id === n.id ? (dark ? '#2a2a2a' : '#eef4ff') : 'transparent',
                  border: `1px solid ${palette.border}`,
                  borderRadius: 10,
                  padding: 12,
                  cursor: 'pointer',
                  color: palette.text,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4, lineHeight: 1.2 }}>{n.title}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 12,
                      background: palette.chip,
                      color: palette.chipText,
                      padding: '2px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {n.source || 'Source'}
                  </span>
                  <span style={{ fontSize: 12, color: palette.subText }}>{fmtDate(n.isoDate)}</span>
                </div>
                <div style={{ fontSize: 13, color: palette.subText }}>
                  {n.summary?.slice(0, 200) || ''}
                  {n.summary && n.summary.length > 200 ? '…' : ''}
                </div>
              </button>
            ))}
        </div>
      </div>

      {/* Center: Selected item */}
      <div
        style={{
          background: palette.railBg,
          border: `1px solid ${palette.border}`,
          borderRadius: 12,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Text as="h2" style={{ marginTop: 0, fontSize: 20, fontWeight: 800 }}>
          {selected ? selected.title : 'Welcome'}
        </Text>

        {!selected ? (
          <div style={{ color: palette.subText, fontSize: 14 }}>
            Pick an item from the left to view a summary here. You can switch themes at the top and refresh the feed anytime.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4, marginBottom: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  background: palette.chip,
                  color: palette.chipText,
                  padding: '2px 8px',
                  borderRadius: 999,
                }}
              >
                {selected.source || 'Source'}
              </span>
              <span style={{ fontSize: 12, color: palette.subText }}>{fmtDate(selected.isoDate)}</span>
            </div>

            <Divider style={{ margin: '8px 0', borderColor: 'transparent' }} />

            <div
              style={{
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                color: palette.text,
                fontSize: 15,
              }}
            >
              {selected.summary || 'No summary available.'}
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              {selected.link && (
                <Button appearance="primary" onClick={() => window.open(selected.link, '_blank', 'noopener,noreferrer')}>
                  Open Original
                </Button>
              )}
              <Button onClick={() => navigator.clipboard?.writeText(selected.link || '')} disabled={!selected.link}>
                Copy Link
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Right rail: Chat */}
      <div
        style={{
          background: palette.railBg,
          border: `1px solid ${palette.border}`,
          borderRadius: 12,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden', // ensure ChatPanel stays inside
        }}
      >
        {/* We lazy-load ChatPanel to avoid import order issues */}
        <ChatMount selected={selected} dark={dark} />
      </div>
    </div>
  );
}

/** Separate component so we can require() lazily (avoids circular import hiccups during edits) */
function ChatMount({ selected, dark }) {
  const [ChatPanel, setChatPanel] = useState(null);

  useEffect(() => {
    // dynamic import
    import('./ChatPanel').then((m) => setChatPanel(() => m.default));
  }, []);

  if (!ChatPanel) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8 }}>
        <Spinner size="tiny" />
        <span style={{ fontSize: 13, opacity: 0.8 }}>Loading chat…</span>
      </div>
    );
  }

  // NOTE: ChatPanel currently uses /api/chat which reads /server/resources.json.
  // Passing the news item won't give server-side context yet, but keeps UX consistent.
  // We can upgrade the server later to accept inline context.
  return <ChatPanel resource={null} dark={dark} />;
}
