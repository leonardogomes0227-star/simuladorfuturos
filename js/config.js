// De onde o site lê o estado do robô 24h (a branch de dados é escrita pelo workflow "Robô 24h").
// Versão visível no rodapé: confira aqui o que está carregado. Troque junto com VERSION em sw.js.
window.RADAR_VERSION = '2.6.0';
window.RADAR_CONFIG = {
  repo: 'leonardogomes0227-star/simuladorfuturos',
  stateBranch: 'robo-estado',
  configPath: 'robo/config.json',
  defaultBranch: 'claude/intelligent-lovelace-w3wr17'
};
