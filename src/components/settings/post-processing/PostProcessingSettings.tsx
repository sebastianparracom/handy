import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { RefreshCcw } from "lucide-react";
import { commands } from "@/bindings";

import { Alert } from "../../ui/Alert";
import { SettingContainer, SettingsGroup, Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { ResetButton } from "../../ui/ResetButton";
import { Input } from "../../ui/Input";

import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { useSettings } from "../../../hooks/useSettings";
import { PromptHotkeyInput } from "./PromptHotkeyInput";

const MAX_POST_PROCESS_PROMPTS = 5;

const PostProcessingSettingsApiComponent: React.FC = () => {
  const { t } = useTranslation();
  const state = usePostProcessProviderState();

  return (
    <>
      <SettingContainer
        title={t("settings.postProcessing.api.provider.title")}
        description={t("settings.postProcessing.api.provider.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <div className="flex items-center gap-2">
          <ProviderSelect
            options={state.providerOptions}
            value={state.selectedProviderId}
            onChange={state.handleProviderSelect}
          />
        </div>
      </SettingContainer>

      {state.isAppleProvider ? (
        state.appleIntelligenceUnavailable ? (
          <Alert variant="error" contained>
            {t("settings.postProcessing.api.appleIntelligence.unavailable")}
          </Alert>
        ) : null
      ) : (
        <>
          {state.selectedProvider?.id === "custom" && (
            <SettingContainer
              title={t("settings.postProcessing.api.baseUrl.title")}
              description={t("settings.postProcessing.api.baseUrl.description")}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped={true}
            >
              <div className="flex items-center gap-2">
                <BaseUrlField
                  value={state.baseUrl}
                  onBlur={state.handleBaseUrlChange}
                  placeholder={t(
                    "settings.postProcessing.api.baseUrl.placeholder",
                  )}
                  disabled={state.isBaseUrlUpdating}
                  className="min-w-[380px]"
                />
              </div>
            </SettingContainer>
          )}

          <SettingContainer
            title={t("settings.postProcessing.api.apiKey.title")}
            description={t("settings.postProcessing.api.apiKey.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped={true}
          >
            <div className="flex items-center gap-2">
              <ApiKeyField
                value={state.apiKey}
                onBlur={state.handleApiKeyChange}
                placeholder={t(
                  "settings.postProcessing.api.apiKey.placeholder",
                )}
                disabled={state.isApiKeyUpdating}
                className="min-w-[320px]"
              />
            </div>
          </SettingContainer>
        </>
      )}

      {!state.isAppleProvider && (
        <SettingContainer
          title={t("settings.postProcessing.api.model.title")}
          description={
            state.isCustomProvider
              ? t("settings.postProcessing.api.model.descriptionCustom")
              : t("settings.postProcessing.api.model.descriptionDefault")
          }
          descriptionMode="tooltip"
          layout="stacked"
          grouped={true}
        >
          <div className="flex items-center gap-2">
            <ModelSelect
              value={state.model}
              options={state.modelOptions}
              disabled={state.isModelUpdating}
              isLoading={state.isFetchingModels}
              placeholder={
                state.modelOptions.length > 0
                  ? t(
                      "settings.postProcessing.api.model.placeholderWithOptions",
                    )
                  : t("settings.postProcessing.api.model.placeholderNoOptions")
              }
              onSelect={state.handleModelSelect}
              onCreate={state.handleModelCreate}
              onBlur={() => {}}
              className="flex-1 min-w-[380px]"
            />
            <ResetButton
              onClick={state.handleRefreshModels}
              disabled={state.isFetchingModels}
              ariaLabel={t("settings.postProcessing.api.model.refreshModels")}
              className="flex h-10 w-10 items-center justify-center"
            >
              <RefreshCcw
                className={`h-4 w-4 ${state.isFetchingModels ? "animate-spin" : ""}`}
              />
            </ResetButton>
          </div>
        </SettingContainer>
      )}
    </>
  );
};

type PromptDraft = {
  name: string;
  prompt: string;
};

const PostProcessingSettingsPromptsComponent: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();
  const [isCreating, setIsCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<PromptDraft>({
    name: "",
    prompt: "",
  });
  const [drafts, setDrafts] = useState<Record<string, PromptDraft>>({});

  const prompts = getSetting("post_process_prompts") || [];

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, PromptDraft> = {};
      for (const prompt of prompts) {
        next[prompt.id] = prev[prompt.id] ?? {
          name: prompt.name,
          prompt: prompt.prompt,
        };
      }
      return next;
    });
  }, [prompts]);

  const handleCreatePrompt = async () => {
    if (!createDraft.name.trim() || !createDraft.prompt.trim()) return;

    try {
      const result = await commands.addPostProcessPrompt(
        createDraft.name.trim(),
        createDraft.prompt.trim(),
      );
      if (result.status === "ok") {
        await refreshSettings();
        setIsCreating(false);
        setCreateDraft({ name: "", prompt: "" });
      } else {
        console.error("Failed to create prompt:", result.error);
      }
    } catch (error) {
      console.error("Failed to create prompt:", error);
    }
  };

  const handleUpdatePrompt = async (promptId: string) => {
    const draft = drafts[promptId];
    if (!draft || !draft.name.trim() || !draft.prompt.trim()) return;

    try {
      await commands.updatePostProcessPrompt(
        promptId,
        draft.name.trim(),
        draft.prompt.trim(),
      );
      await refreshSettings();
    } catch (error) {
      console.error("Failed to update prompt:", error);
    }
  };

  const handleDeletePrompt = async (promptId: string) => {
    try {
      await commands.deletePostProcessPrompt(promptId);
      await refreshSettings();
    } catch (error) {
      console.error("Failed to delete prompt:", error);
    }
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setCreateDraft({ name: "", prompt: "" });
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setCreateDraft({ name: "", prompt: "" });
  };

  const atLimit = prompts.length >= MAX_POST_PROCESS_PROMPTS;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-mid-gray">
          {t("settings.postProcessing.prompts.listDescription", {
            max: MAX_POST_PROCESS_PROMPTS,
          })}
        </p>
        <Button
          onClick={handleStartCreate}
          variant="primary"
          size="md"
          disabled={isCreating || atLimit}
          className="shrink-0"
        >
          {t("settings.postProcessing.prompts.createNew")}
        </Button>
      </div>

      {atLimit && (
        <p className="text-xs text-mid-gray">
          {t("settings.postProcessing.prompts.maxReached", {
            max: MAX_POST_PROCESS_PROMPTS,
          })}
        </p>
      )}

      {isCreating && (
        <div className="space-y-3 rounded-md border border-mid-gray/20 bg-mid-gray/5 p-3">
          <div className="space-y-2 flex flex-col">
            <label className="text-sm font-semibold">
              {t("settings.postProcessing.prompts.promptLabel")}
            </label>
            <Input
              type="text"
              value={createDraft.name}
              onChange={(e) =>
                setCreateDraft((d) => ({ ...d, name: e.target.value }))
              }
              placeholder={t(
                "settings.postProcessing.prompts.promptLabelPlaceholder",
              )}
              variant="compact"
            />
          </div>

          <div className="space-y-2 flex flex-col">
            <label className="text-sm font-semibold">
              {t("settings.postProcessing.prompts.promptInstructions")}
            </label>
            <Textarea
              value={createDraft.prompt}
              onChange={(e) =>
                setCreateDraft((d) => ({ ...d, prompt: e.target.value }))
              }
              placeholder={t(
                "settings.postProcessing.prompts.promptInstructionsPlaceholder",
              )}
            />
            <p className="text-xs text-mid-gray/70">
              <Trans
                i18nKey="settings.postProcessing.prompts.promptTip"
                components={{ code: <code /> }}
              />
            </p>
          </div>

          <p className="text-xs text-mid-gray">
            {t("settings.postProcessing.prompts.hotkeyAfterCreate")}
          </p>

          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleCreatePrompt}
              variant="primary"
              size="md"
              disabled={!createDraft.name.trim() || !createDraft.prompt.trim()}
            >
              {t("settings.postProcessing.prompts.createPrompt")}
            </Button>
            <Button onClick={handleCancelCreate} variant="secondary" size="md">
              {t("settings.postProcessing.prompts.cancel")}
            </Button>
          </div>
        </div>
      )}

      {prompts.map((prompt) => {
        const draft = drafts[prompt.id] ?? {
          name: prompt.name,
          prompt: prompt.prompt,
        };
        const isDirty =
          draft.name.trim() !== prompt.name ||
          draft.prompt.trim() !== prompt.prompt.trim();

        return (
          <div
            key={prompt.id}
            className="space-y-3 rounded-md border border-mid-gray/20 bg-mid-gray/5 p-3"
          >
            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.promptLabel")}
              </label>
              <Input
                type="text"
                value={draft.name}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [prompt.id]: { ...draft, name: e.target.value },
                  }))
                }
                placeholder={t(
                  "settings.postProcessing.prompts.promptLabelPlaceholder",
                )}
                variant="compact"
              />
            </div>

            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.hotkey")}
              </label>
              <PromptHotkeyInput
                promptId={prompt.id}
                binding={prompt.binding ?? ""}
                onChanged={refreshSettings}
              />
              <p className="text-xs text-mid-gray/70">
                {t("settings.postProcessing.prompts.hotkeyHint")}
              </p>
            </div>

            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.promptInstructions")}
              </label>
              <Textarea
                value={draft.prompt}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [prompt.id]: { ...draft, prompt: e.target.value },
                  }))
                }
                placeholder={t(
                  "settings.postProcessing.prompts.promptInstructionsPlaceholder",
                )}
              />
              <p className="text-xs text-mid-gray/70">
                <Trans
                  i18nKey="settings.postProcessing.prompts.promptTip"
                  components={{ code: <code /> }}
                />
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => handleUpdatePrompt(prompt.id)}
                variant="primary"
                size="md"
                disabled={
                  !draft.name.trim() || !draft.prompt.trim() || !isDirty
                }
              >
                {t("settings.postProcessing.prompts.updatePrompt")}
              </Button>
              <Button
                onClick={() => handleDeletePrompt(prompt.id)}
                variant="secondary"
                size="md"
                disabled={prompts.length <= 1}
              >
                {t("settings.postProcessing.prompts.deletePrompt")}
              </Button>
            </div>
          </div>
        );
      })}

      {prompts.length === 0 && !isCreating && (
        <div className="p-3 bg-mid-gray/5 rounded-md border border-mid-gray/20">
          <p className="text-sm text-mid-gray">
            {t("settings.postProcessing.prompts.createFirst")}
          </p>
        </div>
      )}
    </div>
  );
};

export const PostProcessingSettingsApi = React.memo(
  PostProcessingSettingsApiComponent,
);
PostProcessingSettingsApi.displayName = "PostProcessingSettingsApi";

export const PostProcessingSettingsPrompts = React.memo(
  PostProcessingSettingsPromptsComponent,
);
PostProcessingSettingsPrompts.displayName = "PostProcessingSettingsPrompts";

export const PostProcessingSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.postProcessing.api.title")}>
        <PostProcessingSettingsApi />
      </SettingsGroup>

      <SettingsGroup title={t("settings.postProcessing.prompts.title")}>
        <PostProcessingSettingsPrompts />
      </SettingsGroup>
    </div>
  );
};
