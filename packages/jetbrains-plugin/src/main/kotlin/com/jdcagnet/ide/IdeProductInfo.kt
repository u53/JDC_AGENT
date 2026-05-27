package com.jdcagnet.ide

import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.ApplicationNamesInfo

data class IdeProductInfo(
    val ideId: String,
    val ideName: String,
    val ideVersion: String
)

fun currentIdeProductInfo(): IdeProductInfo {
    val names = ApplicationNamesInfo.getInstance()
    val ideName = listOf(names.fullProductName, names.productName)
        .firstOrNull { it.isNotBlank() }
        ?: "JetBrains IDE"

    return IdeProductInfo(
        ideId = ideIdForName(ideName),
        ideName = ideName,
        ideVersion = ApplicationInfo.getInstance().fullVersion
    )
}

fun ideIdForName(ideName: String): String {
    return ideName
        .lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .ifBlank { "jetbrains-ide" }
}
