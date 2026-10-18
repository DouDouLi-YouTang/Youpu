<script setup lang="ts">
/**
 * Folia 三主题共用的「关于」页。
 *
 * 这里不展示应用自身的版本信息 —— 这个页签属于当前歌词面板，用户需要的是
 * 这套视觉语言的来源与授权说明。经典主题仍使用原来的 AboutTab。
 */
const githubUrl = 'https://github.com/chthollyphile/folia-major'
</script>

<template>
  <section class="settings-section">
    <div class="settings-group-title">关于</div>
    <div class="setting-row folia-about">
      <p class="folia-about-title">Folia</p>
      <p class="setting-note">作者：chthollyphile</p>
      <p class="setting-note">
        本项目中的倾诉、流光、浮名主题基于 Folia 的设计与公开文档致敬移植， 不包含原项目的商业素材。
      </p>
      <a class="folia-about-link" :href="githubUrl" target="_blank" rel="noreferrer noopener">
        github.com/chthollyphile/folia-major
      </a>
    </div>
  </section>
</template>

<style scoped lang="scss" src="./folia-settings.scss"></style>
