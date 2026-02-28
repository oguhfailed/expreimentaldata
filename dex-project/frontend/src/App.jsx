import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import Header from './components/Header';
import Swap from './components/Swap';
import Liquidity from './components/Liquidity';
import Farm from './components/Farm';
import './App.css';

export default function App() {
  const [account, setAccount]       = useState(null);
  const [provider, setProvider]     = useState(null);
  const [signer, setSigner]         = useState(null);
  const [deployments, setDeployments] = useState(null);
  const [activeTab, setActiveTab]   = useState('swap');
  const [networkError, setNetworkError] = useState(null);
  const [loadingDeploy, setLoadingDeploy] = useState(true);

  // Load deployments.json from public/
  useEffect(() => {
    fetch('/deployments.json')
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then(data => { setDeployments(data); setLoadingDeploy(false); })
      .catch(() => setLoadingDeploy(false));
  }, []);

  // Reconnect on page reload if already authorised
  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum.request({ method: 'eth_accounts' }).then(async (accounts) => {
      if (accounts.length === 0) return;
      const _provider = new ethers.BrowserProvider(window.ethereum);
      const network   = await _provider.getNetwork();
      if (network.chainId !== 31337n) return;
      const _signer = await _provider.getSigner();
      setProvider(_provider);
      setSigner(_signer);
      setAccount(accounts[0]);
    });
  }, []);

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert('MetaMask is not installed.\nGet it at https://metamask.io');
      return;
    }
    try {
      const _provider = new ethers.BrowserProvider(window.ethereum);
      const network   = await _provider.getNetwork();
      if (network.chainId !== 31337n) {
        setNetworkError('Wrong network — switch MetaMask to Localhost 8545 (chainId 31337)');
        return;
      }
      setNetworkError(null);
      const accounts = await _provider.send('eth_requestAccounts', []);
      const _signer  = await _provider.getSigner();
      setProvider(_provider);
      setSigner(_signer);
      setAccount(accounts[0]);
    } catch (err) {
      console.error('Wallet connection failed:', err);
    }
  };

  // Listen for account / chain changes
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccounts = (accounts) => {
      if (accounts.length === 0) { setAccount(null); setSigner(null); }
      else setAccount(accounts[0]);
    };
    const onChain = () => window.location.reload();
    window.ethereum.on('accountsChanged', onAccounts);
    window.ethereum.on('chainChanged', onChain);
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccounts);
      window.ethereum.removeListener('chainChanged', onChain);
    };
  }, []);

  const sharedProps = { provider, signer, account, deployments };

  return (
    <div className="app">
      <Header
        account={account}
        connectWallet={connectWallet}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        networkError={networkError}
      />

      <main className="main">
        {loadingDeploy ? (
          <div className="center-msg">Loading…</div>
        ) : !deployments ? (
          <div className="no-deploy card">
            <div className="no-deploy-icon">🚀</div>
            <h2>Contracts not deployed yet</h2>
            <p>Follow these steps to get started:</p>
            <ol>
              <li><strong>Terminal 1</strong> — start the local blockchain:<br /><code>cd .. && npx hardhat node</code></li>
              <li><strong>Terminal 2</strong> — deploy all contracts:<br /><code>cd .. && npx hardhat run scripts/deploy.js --network localhost</code></li>
              <li><strong>Terminal 2</strong> — copy addresses to the UI:<br /><code>npm run setup</code></li>
              <li>Refresh this page.</li>
            </ol>
            <p className="metamask-note">Also configure MetaMask: <strong>Network → Add network → Localhost 8545, ChainID 31337</strong></p>
          </div>
        ) : (
          <div className="tab-content">
            {activeTab === 'swap'      && <Swap      {...sharedProps} />}
            {activeTab === 'liquidity' && <Liquidity {...sharedProps} />}
            {activeTab === 'farm'      && <Farm      {...sharedProps} />}
          </div>
        )}
      </main>
    </div>
  );
}
