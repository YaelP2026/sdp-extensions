# Mermaid Viewer

## 1) What This Extension Does

### Short Description
Mermaid Viewer is an external action extension for OpenText SDP/SDM (ValueEdge/ALM Octane) that renders a [Mermaid](https://mermaid.js.org/) diagram stored in a custom UDF field (`mermaid_udf`) directly inside the side panel. 

### Where It Appears
- **Backlog**, **Team Backlog**, and **Quality** modules — side panel for **Features**, in list and details views.

### Main Use Case
- Visualize a feature's diagram (flowchart, sequence diagram, class diagram, etc.) without leaving the backlog.
- Store Mermaid source in the `mermaid_udf` UDF field on a Feature; the panel renders it on demand.
- The panel opens for a **single selected feature** at a time.

### Field Setup
The extension reads the `mermaid_udf` UDF on the `feature` entity. Create this field in **Space Administration → Entities → Feature → Fields** as a Memo field.

## 2) How It Works

1. When the side panel opens, the extension reads the selected feature ID.
2. It fetches those features from the Octane REST API (`/work_items?fields=id,name,mermaid_udf`).
3. The raw field value is normalised (HTML tags stripped, fenced code blocks unwrapped, HTML entities decoded).
4. The cleaned Mermaid source is rendered client-side using the [Mermaid JS library](https://mermaid.js.org/).

## 3) Disclaimers

1. This tool is an extension and not an OOTB functionality. It has been tested in our environment and works well with our data, but it is not an officially supported feature of the product. Treat it similarly to other community plugins in the marketplace.

2. Once loaded, the extension is available to all users in the workspace. It is recommended to trial it in a demo workspace first.
   To restrict the extension to specific workspaces, adjust the configuration JSON:

```json
{
  "workspaces": [1001, 1002],
  "exclude_workspaces": [1003]
}
```

