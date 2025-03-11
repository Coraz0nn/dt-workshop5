import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

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

  let nodeState: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: null,
    k: null,
  };

  // TODO implement this
  // this route allows retrieving the current status of the node
  // Route /status
  node.get("/status", (req, res) => {
    if (isFaulty) {
      return res.status(500).json({ message: "faulty" });
    }
    res.status(200).json({ message: "live" });
  });

  // TODO implement this
  // this route allows the node to receive messages from other nodes
  // Route /message (Handles messages from other nodes)
  node.post("/message", (req, res) => {
    if (nodeState.killed) {
      return res.status(500).json({ message: "Node is stopped" });
    }
    // Placeholder for handling messages in Ben-Or consensus
    res.status(200).json({ message: "Message received" });
  });

  // TODO implement this
  // this route is used to start the consensus algorithm
  // Route /start (Initiates Ben-Or Algorithm)
  node.get("/start", async (req, res) => {
    if (nodeState.killed) {
      return res.status(500).json({ message: "Node is stopped" });
    }
    // Placeholder for Ben-Or algorithm logic
    res.status(200).json({ message: "Consensus algorithm started" });
  });
  // TODO implement this
  // this route is used to stop the consensus algorithm
  // Route /stop (Stops the node activity)
  node.get("/stop", async (req, res) => {
    nodeState.killed = true;
    res.status(200).json({ message: "Node stopped" });
  });
  // TODO implement this
  // get the current state of a node
  // Route /getState
  node.get("/getState", (req, res) => {
    res.json(nodeState);
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
