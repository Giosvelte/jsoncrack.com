import React from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton, Button, Textarea } from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useJson from "../../../store/useJson";
import { parser } from "../../editor/views/GraphView/lib/jsonParser";

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return `${nodeRows[0].value}`;

  const obj = {};
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);
  const setJson = useJson(state => state.setJson);
  const setSelectedNode = useGraph(state => state.setSelectedNode);

  const [isEditing, setIsEditing] = React.useState(false);
  const [draftValue, setDraftValue] = React.useState<string>(normalizeNodeData(nodeData?.text ?? []));

  // keep draft in sync when node changes
  React.useEffect(() => {
    setIsEditing(false);
    setDraftValue(normalizeNodeData(nodeData?.text ?? []));
  }, [nodeData]);

  const setAtPath = (obj: any, path: NodeData["path"] | undefined, value: any) => {
    if (!path || path.length === 0) return value;

    // perform a shallow clone along the path
    const cloned = Array.isArray(obj) ? [...obj] : { ...(obj ?? {}) };
    let cur: any = cloned;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i] as any;
      const nextKey = path[i + 1] as any;
      if (typeof key === "number") {
        cur[key] = Array.isArray(cur[key]) ? [...cur[key]] : cur[key] === undefined ? {} : { ...cur[key] };
      } else {
        cur[key] = cur[key] === undefined ? (typeof nextKey === "number" ? [] : {}) : Array.isArray(cur[key]) ? [...cur[key]] : { ...cur[key] };
      }
      cur = cur[key];
    }

    const lastKey = path[path.length - 1] as any;
    if (typeof lastKey === "number") {
      if (!Array.isArray(cur)) cur = [];
      cur[lastKey] = value;
    } else {
      cur[lastKey] = value;
    }

    // Now rebuild the top-level object by reapplying path
    // Simpler approach: mutate cloned along the way is sufficient because we cloned each level.
    return cloned;
  };

  const onSave = () => {
    if (!nodeData) return;

    let parsedValue: any;
    try {
      parsedValue = JSON.parse(draftValue);
    } catch (e) {
      // if single primitive node (no key) treat as raw string/primitive
      if (nodeData.text && nodeData.text.length === 1 && nodeData.text[0].key == null) {
        // attempt to convert numeric/boolean/null
        const v = draftValue.trim();
        if (v === "null") parsedValue = null;
        else if (v === "true") parsedValue = true;
        else if (v === "false") parsedValue = false;
        else if (!Number.isNaN(Number(v)) && v !== "") parsedValue = Number(v);
        else parsedValue = draftValue;
      } else {
        // try to parse as object — if fails, don't apply
        try {
          parsedValue = JSON.parse(draftValue.replace(/\n$/, ""));
        } catch (err) {
          // invalid JSON for complex node — abort save
          // eslint-disable-next-line no-alert
          alert("Invalid JSON. Please fix the value before saving.");
          return;
        }
      }
    }

    try {
      const raw = useJson.getState().getJson();
      const root = raw ? JSON.parse(raw) : {};

      let updated: any;
      // if path is empty, replace root
      if (!nodeData.path || nodeData.path.length === 0) {
        updated = parsedValue;
      } else {
        // Deep clone root to avoid mutating state
        updated = JSON.parse(JSON.stringify(root));
        // Navigate and set
        let cur = updated;
        const path = nodeData.path;
        for (let i = 0; i < path.length - 1; i++) {
          const key = path[i] as any;
          if (cur[key] === undefined) {
            // create array or object
            cur[key] = typeof path[i + 1] === "number" ? [] : {};
          }
          cur = cur[key];
        }
        const last = path[path.length - 1] as any;
        cur[last] = parsedValue;
      }

      const updatedJsonStr = JSON.stringify(updated, null, 2);
      // update global json (this will trigger graph reparse)
      setJson(updatedJsonStr);

      // update selected node to the corresponding node in the new graph
      const newNodes = parser(updatedJsonStr).nodes;
      const match = newNodes.find(n => JSON.stringify(n.path ?? []) === JSON.stringify(nodeData.path ?? []));
      if (match) setSelectedNode(match as NodeData);

      setIsEditing(false);
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert("Failed to update JSON");
      return;
    }
  };

  const onCancel = () => {
    setDraftValue(normalizeNodeData(nodeData?.text ?? []));
    setIsEditing(false);
  };

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Flex gap="xs" align="center">
              {!isEditing && (
                <Button size="xs" variant="outline" onClick={() => setIsEditing(true)}>
                  Edit
                </Button>
              )}
              {isEditing && (
                <>
                  <Button size="xs" onClick={onSave}>
                    Save
                  </Button>
                  <Button size="xs" variant="subtle" onClick={onCancel}>
                    Cancel
                  </Button>
                </>
              )}
              <CloseButton onClick={onClose} />
            </Flex>
          </Flex>
          <ScrollArea.Autosize mah={250} maw={600}>
            {!isEditing ? (
              <CodeHighlight
                code={normalizeNodeData(nodeData?.text ?? [])}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            ) : (
              <Textarea
                minRows={6}
                maw={600}
                miw={350}
                value={draftValue}
                onChange={e => setDraftValue(e.currentTarget.value)}
              />
            )}
          </ScrollArea.Autosize>
        </Stack>
        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};
