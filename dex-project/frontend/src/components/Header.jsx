export default function Header({ account, connectWallet, activeTab, setActiveTab, networkError }) {
  const tabs = [
    { id: 'swap',      label: 'Swap' },
    { id: 'liquidity', label: 'Liquidity' },
    { id: 'farm',      label: 'Farm' },
  ];

  const shortAddr = account
    ? `${account.slice(0, 6)}…${account.slice(-4)}`
    : null;

  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">⬡ DEX</div>
        <nav className="nav">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`nav-btn ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="header-right">
        {networkError && <span className="network-error">{networkError}</span>}
        <button className="connect-btn" onClick={connectWallet}>
          {shortAddr ?? 'Connect Wallet'}
        </button>
      </div>
    </header>
  );
}
