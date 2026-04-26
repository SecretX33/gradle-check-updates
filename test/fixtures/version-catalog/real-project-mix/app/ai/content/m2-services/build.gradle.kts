import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.allopen)
}

group = "com.example.content.service"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

tasks.withType<KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
    outputs.cacheIf { true }
}

dependencies {
    implementation(project(":app:common"))
    implementation(project(":app:content:m1-data"))
    implementation(project(":app:ai:m2-services"))
    implementation(project(":app:ai:m5-api"))

    // Spring Boot dependencies
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.webflux)

    // Kotlin dependencies
    implementation(libs.kotlin.stdlib)
    implementation(libs.kotlin.reflect)
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.reactor)
    implementation(libs.jedis)

    // serializable
    implementation(libs.hypersistence.utils)

    // Google maps
    implementation(libs.google.maps.services)
    implementation(libs.google.maps.places)
    implementation(libs.google.maps.routing)
    implementation(libs.libphonenumber)

    implementation(libs.commons.lang3)
    implementation(libs.commons.csv)
    implementation(libs.jsoup)

    // AWS SDK for S3 and SQS
    implementation(libs.aws.sdk.s3)
    implementation(libs.aws.sdk.sqs)

    // Test dependencies
    testImplementation(testFixtures(project(":app:content:m1-data")))
    testImplementation(libs.spring.security.test)
    testImplementation(libs.mockk)
    testImplementation(libs.springmockk)
    testImplementation(libs.assertj.core)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.jar {
    enabled = true
    archiveBaseName.set("content-services")
    archiveClassifier.set("")
}

tasks.bootJar {
    enabled = false
}
