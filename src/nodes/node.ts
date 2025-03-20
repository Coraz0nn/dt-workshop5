import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";
import { delay } from "../utils";

interface Message {
  type: "PHASE1" | "PHASE2";
  k: number; // étape/round
  value: Value;
  from: number; // ID du nœud expéditeur
}

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  const state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null: false,
    k: isFaulty ? null : 0,
  };

  // this route allows retrieving the current status of the node
  // Route /status
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // Stockage des messages pour chaque round
  const messagesPhase1: Map<number, Map<number, Value>> = new Map();
  const messagesPhase2: Map<number, Map<number, Value>> = new Map();
  
  // Garde la trace des rounds auxquels le nœud a déjà participé
  const participatedRounds = new Set<number>();

  async function sendMessage(to: number, message: Message) {
    if (state.killed || isFaulty) return;
    
    try {
      await fetch(`http://localhost:${BASE_NODE_PORT + to}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
    } catch (error) {
      // Ignorer les erreurs - le nœud cible peut être défaillant
    }
  }

  // Fonction pour diffuser un message à tous les nœuds
  async function broadcast(message: Message) {
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(sendMessage(i, message));
    }
    await Promise.allSettled(promises);
  }

  // Implémentation l'algorithme Ben-Or
  async function runBenOr() {
    if (isFaulty || state.killed || state.decided) return;
    
    while (!state.decided && !state.killed) {
      const k = state.k as number;
      
      // Vérifier si ce round a déjà été traité
      if (participatedRounds.has(k)) {
        state.k = k + 1;
        continue;
      }
      
      participatedRounds.add(k);
      
      // ===== PHASE 1 =====
      // Diffuser sa valeur
      await broadcast({
        type: "PHASE1",
        k,
        value: state.x as Value,
        from: nodeId,
      });
      
      // Attendre suffisamment de messages de la phase 1
      let phase1Complete = false;
      let tries = 0;
      
      while (!phase1Complete && tries < 10 && !state.killed) {
        await delay(50); // Attendre un peu pour recevoir des messages
        
        const messages = messagesPhase1.get(k) || new Map();
        if (messages.size >= N - F) {
          phase1Complete = true;
        }
        
        tries++;
      }
      
      if (state.killed) break;
      
      // Calculer la valeur à proposer pour la phase 2
      let valueToPropose: Value = "?";
      let count0 = 0;
      let count1 = 0;
      
      // Compter les valeurs reçues
      const messages = messagesPhase1.get(k) || new Map();
      for (const value of messages.values()) {
        if (value === 0) count0++;
        else if (value === 1) count1++;
      }
      
      // Si une majorité stricte (> N/2), choisir cette valeur
      if (count0 > N / 2) {
        valueToPropose = 0;
      } else if (count1 > N / 2) {
        valueToPropose = 1;
      } else {
        // Sinon choisir aléatoirement
        valueToPropose = Math.random() < 0.5 ? 0 : 1;
      }
      
      // ===== PHASE 2 =====
      // Diffuser la proposition
      await broadcast({
        type: "PHASE2",
        k,
        value: valueToPropose,
        from: nodeId,
      });
      
      // Attendre suffisamment de messages de la phase 2
      let phase2Complete = false;
      tries = 0;
      
      while (!phase2Complete && tries < 10 && !state.killed) {
        await delay(50);
        
        const messages = messagesPhase2.get(k) || new Map();
        if (messages.size >= N - F) {
          phase2Complete = true;
        }
        
        tries++;
      }
      
      if (state.killed) break;
      
      // Vérifier les résultats de la phase 2
      const phase2Messages = messagesPhase2.get(k) || new Map();
      count0 = 0;
      count1 = 0;
      
      for (const value of phase2Messages.values()) {
        if (value === 0) count0++;
        else if (value === 1) count1++;
      }
      
      // Si une supermajorité est pour 0 ou 1, décider cette valeur
      if (count0 >= (2 * N) / 3) {
        state.x = 0;
        state.decided = true;
        break;
      } else if (count1 >= (2 * N) / 3) {
        state.x = 1;
        state.decided = true;
        break;
      } 
      // Si une majorité est pour 0 ou 1, adopter cette valeur pour le prochain round
      else if (count0 > N - F) {
        state.x = 0;
      } else if (count1 > N - F) {
        state.x = 1;
      } else {
        // Sinon garder une valeur indéterminée
        state.x = "?";
      }
      
      // Passer au round suivant
      state.k = k + 1;
      
      // Pour éviter les boucles infinies dans les tests
      if (k > 20) {
        break;
      }
    }
  }

  // this route allows the node to receive messages from other nodes
  // Route /message (Handles messages from other nodes)
  node.post("/message", (req, res) => {
    if (state.killed || isFaulty) {
      res.status(200).send();
      return;
    }
    
    const message = req.body as Message;
    const { type, k, value, from } = message;
    
    if (type === "PHASE1") {
      if (!messagesPhase1.has(k)) {
        messagesPhase1.set(k, new Map());
      }
      messagesPhase1.get(k)!.set(from, value);
    } else if (type === "PHASE2") {
      if (!messagesPhase2.has(k)) {
        messagesPhase2.set(k, new Map());
      }
      messagesPhase2.get(k)!.set(from, value);
    }
    
    res.status(200).send();
  });

  // TODO implement this
  // this route is used to start the consensus algorithm
  // Route /start (Initiates Ben-Or Algorithm)
  node.get("/start", async (req, res) => {
    if (!isFaulty && !state.killed) {
      runBenOr().catch(console.error);
    }
    res.status(200).send();
  });

  // TODO implement this
  // this route is used to stop the consensus algorithm
  // Route /stop (Stops the node activity)
  node.get("/stop", async (req, res) => {
    state.killed = true;
    res.status(200).send();
  });
  // TODO implement this
  // get the current state of a node
  // Route /getState
  node.get("/getState", (req, res) => {
    res.status(200).json(state);
  });


  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
