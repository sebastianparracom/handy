import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { commands } from "@/bindings";
import {
  formatKeyCombination,
  getKeyName,
  normalizeKey,
} from "../../../lib/utils/keyboard";
import { useOsType } from "../../../hooks/useOsType";
import { useSettings } from "../../../hooks/useSettings";
import { ResetButton } from "../../ui/ResetButton";
import { SECURE_INPUT_HELP_URL } from "../../SecureInputWarning";

interface PromptHotkeyInputProps {
  promptId: string;
  binding: string;
  disabled?: boolean;
  onChanged: () => Promise<void> | void;
}

interface HandyKeysEvent {
  modifiers: string[];
  key: string | null;
  is_key_down: boolean;
  hotkey_string: string;
}

const MODIFIERS = [
  "ctrl",
  "control",
  "shift",
  "alt",
  "option",
  "meta",
  "command",
  "cmd",
  "super",
  "win",
  "windows",
];

/**
 * Hotkey capture for a single post-process prompt. Commits via
 * `changePostProcessPromptBinding` (empty string clears the hotkey).
 */
export const PromptHotkeyInput: React.FC<PromptHotkeyInputProps> = ({
  promptId,
  binding,
  disabled = false,
  onChanged,
}) => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const osType = useOsType();
  const keyboardImplementation = getSetting("keyboard_implementation");
  const useHandyKeys = keyboardImplementation === "handy_keys";

  const [isRecording, setIsRecording] = useState(false);
  const [keyPressed, setKeyPressed] = useState<string[]>([]);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [currentKeys, setCurrentKeys] = useState("");
  const [originalBinding, setOriginalBinding] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const currentKeysRef = useRef("");
  const keyedShortcutRef = useRef("");
  const modifierOnlyShortcutRef = useRef("");

  const recordingId = `post_process:${promptId}`;

  const commitBinding = useCallback(
    async (next: string) => {
      setIsUpdating(true);
      try {
        const result = await commands.changePostProcessPromptBinding(
          promptId,
          next,
        );
        if (result.status === "error") {
          throw new Error(String(result.error));
        }
        await onChanged();
      } catch (error) {
        console.error("Failed to change prompt binding:", error);
        toast.error(
          t("settings.general.shortcut.errors.set", {
            error: String(error),
          }),
        );
        throw error;
      } finally {
        setIsUpdating(false);
      }
    },
    [promptId, onChanged, t],
  );

  const stopHandyRecording = useCallback(async () => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    await commands.stopHandyKeysRecording().catch(console.error);
  }, []);

  const finishRecording = useCallback(() => {
    setIsRecording(false);
    setKeyPressed([]);
    setRecordedKeys([]);
    setCurrentKeys("");
    currentKeysRef.current = "";
    keyedShortcutRef.current = "";
    modifierOnlyShortcutRef.current = "";
    setOriginalBinding("");
  }, []);

  const cancelRecording = useCallback(async () => {
    if (!isRecording) return;
    if (useHandyKeys) {
      await stopHandyRecording();
    } else {
      await commands.resumeAllBindings().catch(console.error);
    }
    finishRecording();
  }, [isRecording, useHandyKeys, stopHandyRecording, finishRecording]);

  // Tauri (JS) key capture
  useEffect(() => {
    if (!isRecording || useHandyKeys) return;

    let cleanup = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (cleanup || e.repeat) return;
      e.preventDefault();
      const key = normalizeKey(getKeyName(e, osType));
      if (!keyPressed.includes(key)) {
        setKeyPressed((prev) => [...prev, key]);
        if (!recordedKeys.includes(key)) {
          setRecordedKeys((prev) => [...prev, key]);
        }
      }
    };

    const handleKeyUp = async (e: KeyboardEvent) => {
      if (cleanup) return;
      e.preventDefault();
      const key = normalizeKey(getKeyName(e, osType));
      const updatedKeyPressed = keyPressed.filter((k) => k !== key);
      setKeyPressed(updatedKeyPressed);

      if (updatedKeyPressed.length === 0 && recordedKeys.length > 0) {
        const sortedKeys = [...recordedKeys].sort((a, b) => {
          const aIsModifier = MODIFIERS.includes(a.toLowerCase());
          const bIsModifier = MODIFIERS.includes(b.toLowerCase());
          if (aIsModifier && !bIsModifier) return -1;
          if (!aIsModifier && bIsModifier) return 1;
          return 0;
        });
        const newShortcut = sortedKeys.join("+");
        try {
          await commitBinding(newShortcut);
        } catch {
          // Error already toasted
        }
        await commands.resumeAllBindings().catch(console.error);
        finishRecording();
      }
    };

    const handleClickOutside = async (e: MouseEvent) => {
      if (cleanup) return;
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        await commands.resumeAllBindings().catch(console.error);
        finishRecording();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("click", handleClickOutside);

    return () => {
      cleanup = true;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("click", handleClickOutside);
    };
  }, [
    isRecording,
    useHandyKeys,
    keyPressed,
    recordedKeys,
    osType,
    commitBinding,
    finishRecording,
  ]);

  // HandyKeys backend capture
  useEffect(() => {
    if (!isRecording || !useHandyKeys) return;

    let cleanup = false;

    const setupListener = async () => {
      const commitAndStop = async (keysToCommit: string) => {
        try {
          await commitBinding(keysToCommit);
        } catch {
          // Error already toasted
        }
        if (unlistenRef.current) {
          unlistenRef.current();
          unlistenRef.current = null;
        }
        await commands.stopHandyKeysRecording().catch(console.error);
        if (!cleanup) {
          finishRecording();
        }
      };

      const unlisten = await listen<HandyKeysEvent>(
        "handy-keys-event",
        async (event) => {
          if (cleanup) return;
          const { key, is_key_down, hotkey_string } = event.payload;

          if (is_key_down) {
            setCurrentKeys(hotkey_string);
            currentKeysRef.current = hotkey_string;
            if (key) {
              keyedShortcutRef.current = hotkey_string;
              modifierOnlyShortcutRef.current = "";
            } else {
              modifierOnlyShortcutRef.current = hotkey_string;
            }
            return;
          }

          if (key && keyedShortcutRef.current) {
            await commitAndStop(keyedShortcutRef.current);
            return;
          }

          if (
            !key &&
            !keyedShortcutRef.current &&
            modifierOnlyShortcutRef.current &&
            !hotkey_string
          ) {
            await commitAndStop(modifierOnlyShortcutRef.current);
          }
        },
      );

      unlistenRef.current = unlisten;
    };

    setupListener();

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        cancelRecording();
      }
    };
    window.addEventListener("click", handleClickOutside);

    return () => {
      cleanup = true;
      window.removeEventListener("click", handleClickOutside);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [isRecording, useHandyKeys, commitBinding, finishRecording, cancelRecording]);

  const startRecording = async () => {
    if (isRecording || disabled) return;
    setOriginalBinding(binding);

    if (useHandyKeys) {
      try {
        const result = await commands.startHandyKeysRecording(recordingId);
        if (result.status === "error") {
          if (String(result.error).includes("secure-input-active")) {
            toast.error(t("secureInput.recorderBlocked"), {
              action: {
                label: t("secureInput.learnMore"),
                onClick: () => openUrl(SECURE_INPUT_HELP_URL),
              },
            });
          } else {
            toast.error(
              t("settings.general.shortcut.errors.set", {
                error: String(result.error),
              }),
            );
          }
          return;
        }
        setIsRecording(true);
        setCurrentKeys("");
        currentKeysRef.current = "";
        keyedShortcutRef.current = "";
        modifierOnlyShortcutRef.current = "";
      } catch (error) {
        console.error("Failed to start recording:", error);
        toast.error(
          t("settings.general.shortcut.errors.set", {
            error: String(error),
          }),
        );
      }
      return;
    }

    await commands.suspendAllBindings().catch(console.error);
    setIsRecording(true);
    setKeyPressed([]);
    setRecordedKeys([]);
  };

  const clearBinding = async () => {
    if (isRecording) {
      await cancelRecording();
    }
    if (!binding && !originalBinding) return;
    try {
      await commitBinding("");
    } catch {
      // Error already toasted
    }
  };

  const displayWhileRecording = useHandyKeys
    ? currentKeys
      ? formatKeyCombination(currentKeys, osType)
      : t("settings.general.shortcut.pressKeys")
    : recordedKeys.length > 0
      ? formatKeyCombination(recordedKeys.join("+"), osType)
      : t("settings.general.shortcut.pressKeys");

  return (
    <div className="flex items-center gap-1" ref={containerRef}>
      {isRecording ? (
        <div className="px-2 py-1 text-sm font-semibold border border-logo-primary bg-logo-primary/30 rounded-md">
          {displayWhileRecording}
        </div>
      ) : (
        <div
          className={`px-2 py-1 text-sm font-semibold rounded-md border ${
            disabled
              ? "bg-mid-gray/5 border-mid-gray/40 text-mid-gray cursor-not-allowed"
              : "bg-mid-gray/10 border-mid-gray/80 hover:bg-logo-primary/10 cursor-pointer hover:border-logo-primary"
          }`}
          onClick={() => {
            if (!disabled) startRecording();
          }}
        >
          {binding
            ? formatKeyCombination(binding, osType)
            : t("settings.postProcessing.prompts.noHotkey")}
        </div>
      )}
      <ResetButton
        onClick={clearBinding}
        disabled={disabled || isUpdating || (!binding && !isRecording)}
        ariaLabel={t("settings.postProcessing.prompts.clearHotkey")}
      />
    </div>
  );
};
