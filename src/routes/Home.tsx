import styles from './Home.module.css';

export function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <img className={styles.badge} src="/favicon.svg" alt="" />
        <p className={styles.title}>Learning Adventure Island</p>
      </header>
      <main className={styles.main} id="main-content">
        <h1 className={styles.heading}>The island is being built</h1>
        <p className={styles.lead}>
          This is the Phase 0 application shell. The map, companion, and adventures arrive in later
          phases.
        </p>
      </main>
      <footer className={styles.footer}>
        <p>Learning Adventure Island</p>
      </footer>
    </div>
  );
}
