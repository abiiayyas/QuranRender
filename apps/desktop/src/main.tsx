import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { applyTheme, loadTheme } from "./theme";
import "../../../design/system/tokens.css";
import "../../../design/system/components.css";
import "./index.css";

applyTheme(loadTheme());

const root = document.getElementById("root");
if (!root) throw new Error("Elemen #root tidak ditemukan");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
