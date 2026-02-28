import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { FARM_ABI, ERC20_ABI, PAIR_ABI } from '../abis';

export default function Farm({ provider, signer, account, deployments }) {
  const [pools,   setPools]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState('');
  const [rewardBal, setRewardBal] = useState('0');

  // Per-pool transaction loading state and input values
  const [txBusy,   setTxBusy]   = useState({});
  const [depAmts,  setDepAmts]  = useState({});
  const [witAmts,  setWitAmts]  = useState({});

  const loadPools = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    try {
      const farm = new ethers.Contract(deployments.farm, FARM_ABI, provider);
      const [poolLen, rewardAddr] = await Promise.all([
        farm.poolLength(),
        farm.rewardToken(),
      ]);

      // Reward token balance
      if (account) {
        const rwToken = new ethers.Contract(rewardAddr, ERC20_ABI, provider);
        const bal     = await rwToken.balanceOf(account);
        setRewardBal(ethers.formatUnits(bal, 18));
      }

      // Load all pools in parallel
      const pids = Array.from({ length: Number(poolLen) }, (_, i) => i);
      const data = await Promise.all(pids.map(async (pid) => {
        const [lpToken, allocPoint, , , totalStaked, name] = await farm.getPoolInfo(pid);

        let userStaked = '0';
        let pending    = '0';
        let lpBalance  = '0';

        if (account) {
          const [userInfo, pendingRaw, lpBal] = await Promise.all([
            farm.getUserInfo(pid, account),
            farm.pendingReward(pid, account),
            new ethers.Contract(lpToken, PAIR_ABI, provider).balanceOf(account),
          ]);
          userStaked = ethers.formatUnits(userInfo[0], 18);
          pending    = ethers.formatUnits(pendingRaw, 18);
          lpBalance  = ethers.formatUnits(lpBal, 18);
        }

        return {
          pid,
          name,
          lpToken,
          allocPoint: Number(allocPoint),
          totalStaked: ethers.formatUnits(totalStaked, 18),
          userStaked,
          pending,
          lpBalance,
        };
      }));

      setPools(data);
    } catch (e) {
      console.error('Farm load error:', e);
    }
    setLoading(false);
  }, [provider, account, deployments]);

  useEffect(() => { loadPools(); }, [loadPools]);

  const setBusy = (pid, val) => setTxBusy(prev => ({ ...prev, [pid]: val }));

  const handleDeposit = async (pid) => {
    const amount = depAmts[pid];
    if (!signer || !amount || parseFloat(amount) <= 0) return;
    setBusy(pid, true); setStatus('');
    try {
      const farm    = new ethers.Contract(deployments.farm, FARM_ABI, signer);
      const pool    = pools.find(p => p.pid === pid);
      const lpC     = new ethers.Contract(pool.lpToken, PAIR_ABI, signer);
      const parsed  = ethers.parseUnits(amount, 18);

      setStatus('Approving LP token…');
      const allow = await lpC.allowance(account, deployments.farm);
      if (allow < parsed) await (await lpC.approve(deployments.farm, ethers.MaxUint256)).wait();

      setStatus(`Depositing into ${pool.name}…`);
      await (await farm.deposit(pid, parsed)).wait();

      setStatus(`✅ Staked ${amount} LP into ${pool.name}`);
      setDepAmts(prev => ({ ...prev, [pid]: '' }));
      await loadPools();
    } catch (e) {
      setStatus(`❌ ${e.reason ?? e.shortMessage ?? e.message}`);
    }
    setBusy(pid, false);
  };

  const handleWithdraw = async (pid) => {
    const amount = witAmts[pid];
    if (!signer || !amount || parseFloat(amount) <= 0) return;
    setBusy(pid, true); setStatus('');
    try {
      const farm   = new ethers.Contract(deployments.farm, FARM_ABI, signer);
      const pool   = pools.find(p => p.pid === pid);
      const parsed = ethers.parseUnits(amount, 18);

      setStatus(`Withdrawing from ${pool.name}…`);
      await (await farm.withdraw(pid, parsed)).wait();

      setStatus(`✅ Unstaked ${amount} LP from ${pool.name}`);
      setWitAmts(prev => ({ ...prev, [pid]: '' }));
      await loadPools();
    } catch (e) {
      setStatus(`❌ ${e.reason ?? e.shortMessage ?? e.message}`);
    }
    setBusy(pid, false);
  };

  const handleHarvest = async (pid) => {
    if (!signer) return;
    setBusy(pid, true); setStatus('');
    try {
      const farm = new ethers.Contract(deployments.farm, FARM_ABI, signer);
      const pool = pools.find(p => p.pid === pid);
      setStatus(`Harvesting rewards from ${pool.name}…`);
      await (await farm.harvest(pid)).wait();
      setStatus(`✅ DRWD rewards harvested from ${pool.name}`);
      await loadPools();
    } catch (e) {
      setStatus(`❌ ${e.reason ?? e.shortMessage ?? e.message}`);
    }
    setBusy(pid, false);
  };

  const statusClass = status.startsWith('✅') ? 'success'
                    : status.startsWith('❌') ? 'error'
                    : 'info';

  if (loading) {
    return (
      <div className="farm-container">
        <div className="farm-loading">Loading yield farm pools…</div>
      </div>
    );
  }

  return (
    <div className="farm-container">
      {/* Header row */}
      <div className="farm-header">
        <h2>Yield Farming</h2>
        {account && (
          <div className="reward-balance">
            DRWD Balance: {parseFloat(rewardBal).toFixed(4)}
          </div>
        )}
      </div>

      {/* Global status */}
      {status && (
        <div className={`status global-status ${statusClass}`}>{status}</div>
      )}

      {/* Pool grid */}
      <div className="pool-grid">
        {pools.map(pool => (
          <div key={pool.pid} className="pool-card card">
            {/* Pool title */}
            <div className="pool-card-header">
              <h3>{pool.name}</h3>
              <span className="pool-id">#{pool.pid}</span>
            </div>

            {/* Stats */}
            <div className="pool-stats">
              <div className="stat">
                <span className="stat-label">Total Staked</span>
                <span className="stat-value">{parseFloat(pool.totalStaked).toFixed(4)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Your LP Balance</span>
                <span className="stat-value">{parseFloat(pool.lpBalance).toFixed(4)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Your Stake</span>
                <span className="stat-value">{parseFloat(pool.userStaked).toFixed(4)}</span>
              </div>
              <div className="stat highlight">
                <span className="stat-label">Pending DRWD</span>
                <span className="stat-value">{parseFloat(pool.pending).toFixed(6)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="pool-actions">
              {/* Stake */}
              <div className="action-row">
                <input
                  className="mini-input"
                  type="number"
                  placeholder="LP amount"
                  value={depAmts[pool.pid] ?? ''}
                  onChange={e => setDepAmts(prev => ({ ...prev, [pool.pid]: e.target.value }))}
                  onFocus={() => {
                    // Quick-fill with max LP balance on focus if empty
                  }}
                />
                <button
                  className="mini-btn deposit-btn"
                  onClick={() => handleDeposit(pool.pid)}
                  disabled={txBusy[pool.pid] || !account}
                  title="Stake LP tokens"
                >
                  {txBusy[pool.pid] ? '…' : 'Stake'}
                </button>
              </div>

              {/* Unstake */}
              <div className="action-row">
                <input
                  className="mini-input"
                  type="number"
                  placeholder="LP amount"
                  value={witAmts[pool.pid] ?? ''}
                  onChange={e => setWitAmts(prev => ({ ...prev, [pool.pid]: e.target.value }))}
                />
                <button
                  className="mini-btn withdraw-btn"
                  onClick={() => handleWithdraw(pool.pid)}
                  disabled={txBusy[pool.pid] || !account || parseFloat(pool.userStaked) === 0}
                  title="Unstake LP tokens"
                >
                  {txBusy[pool.pid] ? '…' : 'Unstake'}
                </button>
              </div>

              {/* Harvest */}
              <button
                className="harvest-btn"
                onClick={() => handleHarvest(pool.pid)}
                disabled={txBusy[pool.pid] || !account || parseFloat(pool.pending) === 0}
              >
                {txBusy[pool.pid]
                  ? 'Processing…'
                  : `Harvest ${parseFloat(pool.pending).toFixed(4)} DRWD`}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
